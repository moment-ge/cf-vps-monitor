package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/shirou/gopsutil/v4/cpu"
	psnet "github.com/shirou/gopsutil/v4/net"
)

func TestCounterReset(t *testing.T) {
	if counterRate(1000, 20, 120) != 0 {
		t.Fatal("counter reset must not produce a negative or overflowing rate")
	}
	if counterRate(0, 1200, 120) != 10 {
		t.Fatal("interval average is wrong")
	}
}
func TestNetworkSelection(t *testing.T) {
	stats := []psnet.IOCountersStat{
		{Name: "eth0", BytesSent: 120, BytesRecv: 240},
		{Name: "lo", BytesSent: 1000, BytesRecv: 1000},
		{Name: "docker0", BytesSent: 500, BytesRecv: 500},
	}
	if _, err := selectNetworkCounters(stats, "ens3"); err == nil {
		t.Fatal("a missing interface must fail instead of reporting zero traffic")
	}
	for _, name := range []string{"", "eth0"} {
		result, err := selectNetworkCounters(stats, name)
		if err != nil || result.BytesSent != 120 || result.BytesRecv != 240 {
			t.Fatalf("incorrect counters for %q: %+v, %v", name, result, err)
		}
	}
	if result, err := selectNetworkCounters(stats, "lo"); err != nil || result.BytesSent != 1000 {
		t.Fatal("explicitly selected interfaces must remain supported")
	}
}
func TestCPUAccounting(t *testing.T) {
	before := cpu.TimesStat{User: 10, System: 10, Idle: 80}
	after := cpu.TimesStat{User: 20, System: 20, Idle: 160}
	if cpuUsage(before, after) != 20 {
		t.Fatal("CPU delta calculation is wrong")
	}
	if cpuUsage(after, before) != 0 {
		t.Fatal("counter reset must be safe")
	}
}
func TestConfigRejectsInsecureEndpoints(t *testing.T) {
	for _, endpoint := range []string{"http://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?token=secret"} {
		path := filepath.Join(t.TempDir(), "config.json")
		data := `{"endpoint":"` + endpoint + `","token":"` + strings.Repeat("x", 64) + `"}`
		if err := os.WriteFile(path, []byte(data), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := loadConfig(path); err == nil {
			t.Fatalf("accepted unsafe endpoint %s", endpoint)
		}
	}
}
