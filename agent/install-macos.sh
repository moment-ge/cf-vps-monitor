#!/bin/sh
set -eu

agent_binary=${1:?Provide the compiled agent binary}
agent_config=${2:?Provide config.json downloaded from the admin panel}
agent_destination="$HOME/Library/Application Support/CFMonitor"
agent_plist="$HOME/Library/LaunchAgents/com.cfmonitor.agent.plist"

if [ "$(id -u)" = 0 ]; then printf '%s\n' 'Run as your normal macOS user, without sudo.'; exit 1; fi
[ -f "$agent_binary" ] && [ -f "$agent_config" ] || { printf '%s\n' 'Binary or configuration does not exist.'; exit 1; }
mkdir -p "$agent_destination" "$HOME/Library/LaunchAgents"
chmod 700 "$agent_destination"
launchctl bootout "gui/$(id -u)/com.cfmonitor.agent" 2>/dev/null || true
install -m 700 "$agent_binary" "$agent_destination/cf-monitor-agent"
install -m 600 "$agent_config" "$agent_destination/config.json"

# plutil creates a structured plist and correctly escapes paths containing spaces or XML characters.
plutil -create xml1 "$agent_plist"
plutil -insert Label -string com.cfmonitor.agent "$agent_plist"
plutil -insert ProgramArguments -json '[]' "$agent_plist"
plutil -insert ProgramArguments.0 -string "$agent_destination/cf-monitor-agent" "$agent_plist"
plutil -insert ProgramArguments.1 -string '-config' "$agent_plist"
plutil -insert ProgramArguments.2 -string "$agent_destination/config.json" "$agent_plist"
plutil -insert RunAtLoad -bool true "$agent_plist"
plutil -insert KeepAlive -json '{"SuccessfulExit":false}' "$agent_plist"
plutil -insert ThrottleInterval -integer 300 "$agent_plist"
plutil -insert ProcessType -string Background "$agent_plist"
plutil -insert LowPriorityIO -bool true "$agent_plist"
plutil -insert Nice -integer 10 "$agent_plist"
chmod 600 "$agent_plist"
launchctl bootstrap "gui/$(id -u)" "$agent_plist"
printf '%s\n' 'Installed as a login agent. It runs while this macOS user is logged in.'
