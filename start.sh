#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

FOREGROUND=0
BOOTSTRAP_ARGS=()

usage() {
  cat <<'USAGE'
Usage: ./start.sh [options]

Bootstraps and starts the ExtraHop Investigation Agent.
By default the web service is started in the background and this command exits.

Options:
  --foreground, -f  Keep the web service attached to this terminal.
  --help, -h        Show this help.

All other options are passed through to scripts/bootstrap.sh, such as
--with-tshark, --with-pdf, --skip-pi, --skip-excli, and --yes.

Environment:
  EH_AGENT_LOG      Log file for background mode (default: ./start.log)
  EH_AGENT_PIDFILE  PID file for background mode (default: ./app.pid)
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --foreground|-f)
      FOREGROUND=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      BOOTSTRAP_ARGS+=("$1")
      shift
      ;;
  esac
done

# Run through bash so a lost execute bit on bootstrap.sh cannot block startup.
if [[ "$FOREGROUND" -eq 1 ]]; then
  exec bash "$ROOT_DIR/scripts/bootstrap.sh" --start "${BOOTSTRAP_ARGS[@]}"
fi

bash "$ROOT_DIR/scripts/bootstrap.sh" "${BOOTSTRAP_ARGS[@]}"

LOG_FILE="${EH_AGENT_LOG:-$ROOT_DIR/start.log}"
PID_FILE="${EH_AGENT_PIDFILE:-$ROOT_DIR/app.pid}"

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ "$existing_pid" =~ ^[0-9]+$ ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "ExtraHop Investigation Agent is already running (PID $existing_pid)."
    echo "Log: $LOG_FILE"
    exit 0
  fi
fi

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$PID_FILE")"
nohup node server.js >> "$LOG_FILE" 2>&1 &
pid=$!
echo "$pid" > "$PID_FILE"

# Give immediate feedback if startup fails before the command returns.
sleep 1
if ! kill -0 "$pid" 2>/dev/null; then
  echo "ExtraHop Investigation Agent failed to start. Last log lines:" >&2
  tail -40 "$LOG_FILE" >&2 || true
  exit 1
fi

echo "ExtraHop Investigation Agent started in the background (PID $pid)."
echo "Log: $LOG_FILE"
echo "Stop: kill \$(cat '$PID_FILE')"
