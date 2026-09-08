#!/bin/sh
set -eu

if [ "$(id -u)" != 0 ]; then
  printf '%s\n' 'Run with sudo: sudo sh install-linux.sh /path/to/binary /path/to/config.json'
  exit 1
fi

agent_binary=${1:?Provide the compiled agent binary}
agent_config=${2:?Provide config.json downloaded from the admin panel}
agent_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

command -v systemctl >/dev/null 2>&1 || { printf '%s\n' 'systemd is required. See the manual for OpenRC or other service managers.'; exit 1; }
[ -f "$agent_binary" ] && [ -f "$agent_config" ] || { printf '%s\n' 'Binary or configuration does not exist.'; exit 1; }
if ! id cf-monitor >/dev/null 2>&1; then
  useradd --system --no-create-home --shell /usr/sbin/nologin cf-monitor
fi
install -d -m 755 /opt/cf-monitor
install -d -m 750 -o root -g cf-monitor /etc/cf-monitor
if systemctl is-active --quiet cf-monitor.service; then systemctl stop cf-monitor.service; fi
install -m 755 "$agent_binary" /opt/cf-monitor/cf-monitor-agent
install -m 640 -o root -g cf-monitor "$agent_config" /etc/cf-monitor/config.json
install -m 644 "$agent_dir/cf-monitor.service" /etc/systemd/system/cf-monitor.service
systemctl daemon-reload
systemctl enable --now cf-monitor.service
printf '%s\n' 'Installed. Check status: systemctl status cf-monitor.service'
