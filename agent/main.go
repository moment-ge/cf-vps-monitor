package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"runtime"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	psnet "github.com/shirou/gopsutil/v4/net"
)

var version = "1.0.0"

type Config struct {
	Endpoint         string `json:"endpoint"`
	Token            string `json:"token"`
	Interval         int    `json:"interval"`
	DiskPath         string `json:"diskPath"`
	NetworkInterface string `json:"networkInterface"`
	TCPProbe         string `json:"tcpProbe"`
	ProbeEvery       int    `json:"probeEvery"`
}

type Metrics struct {
	OS            string   `json:"os"`
	Arch          string   `json:"arch"`
	CPUModel      string   `json:"cpuModel"`
	CPUCores      int      `json:"cpuCores"`
	CPU           float64  `json:"cpu"`
	MemoryUsed    uint64   `json:"memoryUsed"`
	MemoryTotal   uint64   `json:"memoryTotal"`
	DiskUsed      uint64   `json:"diskUsed"`
	DiskTotal     uint64   `json:"diskTotal"`
	UploadRate    float64  `json:"uploadRate"`
	DownloadRate  float64  `json:"downloadRate"`
	UploadTotal   uint64   `json:"uploadTotal"`
	DownloadTotal uint64   `json:"downloadTotal"`
	Uptime        uint64   `json:"uptime"`
	LatencyMS     *float64 `json:"latencyMs"`
	LossPercent   *float64 `json:"lossPercent"`
}

func loadConfig(path string) (Config, error) {
	var c Config
	f, err := os.Open(path)
	if err != nil {
		return c, err
	}
	defer f.Close()
	decoder := json.NewDecoder(io.LimitReader(f, 16385))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&c); err != nil {
		return c, err
	}
	var extra any
	if err = decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return c, errors.New("config must contain one JSON object")
	}
	u, err := url.Parse(c.Endpoint)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return c, errors.New("endpoint must be an origin URL")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return c, errors.New("endpoint requires HTTPS; HTTP is only allowed on localhost")
	}
	if len(c.Token) < 32 || len(c.Token) > 128 || strings.ContainsAny(c.Token, "\r\n ") {
		return c, errors.New("invalid node token")
	}
	c.Endpoint = strings.TrimRight(c.Endpoint, "/")
	if c.Interval == 0 {
		c.Interval = 120
	}
	if c.Interval < 60 || c.Interval > 3600 {
		return c, errors.New("interval must be between 60 and 3600 seconds")
	}
	if c.ProbeEvery == 0 {
		c.ProbeEvery = 5
	}
	if c.ProbeEvery < 1 || c.ProbeEvery > 60 {
		return c, errors.New("probeEvery must be between 1 and 60")
	}
	if c.TCPProbe != "" {
		if _, _, err = net.SplitHostPort(c.TCPProbe); err != nil {
			return c, errors.New("tcpProbe must be host:port")
		}
	}
	if c.DiskPath == "" {
		c.DiskPath = "/"
		if runtime.GOOS == "windows" {
			c.DiskPath = os.Getenv("SystemDrive") + "\\"
		}
	}
	return c, nil
}

type Collector struct {
	config       Config
	base         Metrics
	previous     psnet.IOCountersStat
	previousTime time.Time
	previousCPU  cpu.TimesStat
	latency      *float64
	loss         *float64
	cycles       int
}

func networkCounters(name string) (psnet.IOCountersStat, error) {
	stats, err := psnet.IOCounters(true)
	if err != nil {
		return psnet.IOCountersStat{}, err
	}
	return selectNetworkCounters(stats, name)
}

func selectNetworkCounters(stats []psnet.IOCountersStat, name string) (psnet.IOCountersStat, error) {
	var total psnet.IOCountersStat
	found := false
	for _, s := range stats {
		if name != "" && s.Name != name {
			continue
		}
		if name == "" && (s.Name == "lo" || s.Name == "lo0" || strings.HasPrefix(s.Name, "Loopback") || strings.HasPrefix(s.Name, "veth") || strings.HasPrefix(s.Name, "docker") || strings.HasPrefix(s.Name, "br-") || strings.HasPrefix(s.Name, "utun")) {
			continue
		}
		total.BytesSent += s.BytesSent
		total.BytesRecv += s.BytesRecv
		found = true
	}
	if name != "" && !found {
		return total, fmt.Errorf("network interface %q was not found", name)
	}
	return total, nil
}

func newCollector(c Config) (*Collector, error) {
	info, err := host.Info()
	if err != nil {
		return nil, err
	}
	stats, err := cpu.Times(false)
	if err != nil || len(stats) == 0 {
		return nil, errors.New("cannot read CPU counters")
	}
	network, err := networkCounters(c.NetworkInterface)
	if err != nil {
		return nil, err
	}
	model := runtime.GOARCH
	if infos, err := cpu.Info(); err == nil && len(infos) > 0 {
		model = infos[0].ModelName
	}
	cores := runtime.NumCPU()
	if n, err := cpu.Counts(true); err == nil && n > 0 {
		cores = n
	}
	return &Collector{config: c, base: Metrics{OS: strings.TrimSpace(info.Platform + " " + info.PlatformVersion), Arch: runtime.GOARCH, CPUModel: model, CPUCores: cores}, previousCPU: stats[0], previous: network, previousTime: time.Now()}, nil
}

func cpuUsage(before, after cpu.TimesStat) float64 {
	totalBefore := before.User + before.System + before.Idle + before.Nice + before.Iowait + before.Irq + before.Softirq + before.Steal
	totalAfter := after.User + after.System + after.Idle + after.Nice + after.Iowait + after.Irq + after.Softirq + after.Steal
	delta := totalAfter - totalBefore
	if delta <= 0 {
		return 0
	}
	busy := delta - (after.Idle - before.Idle) - (after.Iowait - before.Iowait)
	return math.Max(0, math.Min(100, busy/delta*100))
}

func counterRate(before, after uint64, seconds float64) float64 {
	if seconds <= 0 || after < before {
		return 0
	}
	return float64(after-before) / seconds
}

func (c *Collector) collect(ctx context.Context) (Metrics, error) {
	m := c.base
	vm, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		return m, err
	}
	d, err := disk.UsageWithContext(ctx, c.config.DiskPath)
	if err != nil {
		return m, err
	}
	times, err := cpu.TimesWithContext(ctx, false)
	if err != nil || len(times) == 0 {
		return m, errors.New("cannot read CPU counters")
	}
	network, err := networkCounters(c.config.NetworkInterface)
	if err != nil {
		return m, err
	}
	now := time.Now()
	m.CPU = cpuUsage(c.previousCPU, times[0])
	m.UploadRate = counterRate(c.previous.BytesSent, network.BytesSent, now.Sub(c.previousTime).Seconds())
	m.DownloadRate = counterRate(c.previous.BytesRecv, network.BytesRecv, now.Sub(c.previousTime).Seconds())
	c.previousCPU, c.previous, c.previousTime = times[0], network, now
	m.MemoryUsed, m.MemoryTotal = vm.Used, vm.Total
	m.DiskUsed, m.DiskTotal = d.Used, d.Total
	m.UploadTotal, m.DownloadTotal = network.BytesSent, network.BytesRecv
	m.Uptime, err = host.UptimeWithContext(ctx)
	if err != nil {
		return m, err
	}
	if c.config.TCPProbe != "" && c.cycles%c.config.ProbeEvery == 0 {
		var successes int
		var elapsed float64
		for i := 0; i < 3; i++ {
			start := time.Now()
			conn, err := (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "tcp", c.config.TCPProbe)
			if err == nil {
				successes++
				elapsed += float64(time.Since(start).Microseconds()) / 1000
				conn.Close()
			}
		}
		loss := float64(3-successes) / 3 * 100
		c.loss = &loss
		c.latency = nil
		if successes > 0 {
			latency := elapsed / float64(successes)
			c.latency = &latency
		}
	}
	c.cycles++
	m.LatencyMS, m.LossPercent = c.latency, c.loss
	return m, nil
}

func report(ctx context.Context, client *http.Client, c Config, m Metrics) (int, int, error) {
	data, err := json.Marshal(m)
	if err != nil {
		return c.Interval, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint+"/api/agent/report", bytes.NewReader(data))
	if err != nil {
		return c.Interval, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("User-Agent", "cf-monitor-agent/"+version)
	resp, err := client.Do(req)
	if err != nil {
		return c.Interval, 0, errors.New("report connection failed")
	}
	defer resp.Body.Close()
	var result struct {
		Interval int `json:"interval"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 16384)).Decode(&result)
	interval := c.Interval
	if result.Interval >= 60 && result.Interval <= 86400 {
		interval = result.Interval
	}
	if resp.StatusCode != 200 {
		return interval, resp.StatusCode, fmt.Errorf("report returned HTTP %d", resp.StatusCode)
	}
	return interval, resp.StatusCode, nil
}

func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func main() {
	configPath := flag.String("config", "config.json", "Configuration file path")
	once := flag.Bool("once", false, "Collect and report one sample")
	printMetrics := flag.Bool("print", false, "Collect one sample without uploading")
	showVersion := flag.Bool("version", false, "Print version")
	flag.Parse()
	if *showVersion {
		fmt.Println(version)
		return
	}
	runtime.GOMAXPROCS(1)
	debug.SetMemoryLimit(24 << 20)
	debug.SetGCPercent(50)
	c, err := loadConfig(*configPath)
	if err != nil {
		log.Fatal("Configuration error: ", err)
	}
	collector, err := newCollector(c)
	if err != nil {
		log.Fatal("Collector initialization failed: ", err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	client := &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return errors.New("redirects are disabled") }, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, MaxIdleConns: 1, MaxIdleConnsPerHost: 1, IdleConnTimeout: 30 * time.Second, TLSHandshakeTimeout: 8 * time.Second, ResponseHeaderTimeout: 10 * time.Second}}
	delay := 1 * time.Second
	if !*once && !*printMetrics {
		delay += time.Duration(rand.IntN(30)) * time.Second
	}
	if !wait(ctx, delay) {
		return
	}
	interval, failures := c.Interval, 0
	log.Printf("Agent %s started; sample interval %ds; no remote execution", version, interval)
	for {
		sampleCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		metrics, sampleErr := collector.collect(sampleCtx)
		cancel()
		if sampleErr == nil && *printMetrics {
			_ = json.NewEncoder(os.Stdout).Encode(metrics)
			return
		}
		status := 0
		if sampleErr == nil {
			interval, status, sampleErr = report(ctx, client, c, metrics)
		}
		if sampleErr != nil {
			failures++
			if failures == 1 || failures%10 == 0 {
				log.Printf("Collection/report failed (%d consecutive): %v", failures, sampleErr)
			}
			if *once || *printMetrics {
				os.Exit(1)
			}
			if status == 401 {
				log.Print("Node token rejected; update config and restart the agent")
				os.Exit(1)
			}
		} else {
			if failures > 0 {
				log.Print("Reporting recovered")
			}
			failures = 0
		}
		if *once {
			return
		}
		backoff := interval
		if failures > 0 && status != 429 {
			backoff = min(3600, interval*(1<<min(failures, 5)))
		}
		jitter := time.Duration(rand.IntN(max(1, backoff/20))) * time.Second
		if !wait(ctx, time.Duration(backoff)*time.Second+jitter) {
			return
		}
	}
}
