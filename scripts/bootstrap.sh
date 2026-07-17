#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
EXCLI_INTERFACE="$ROOT_DIR/excli-interface"
EXCLI_BINARY="$ROOT_DIR/bin/excli"
EXCLI_RELEASE_DIR="$ROOT_DIR/vendor/excli"
LEGACY_EXCLI_WRAPPER="$ROOT_DIR/excli"
LEGACY_EXCLI_REAL="$ROOT_DIR/bin/excli-real"

START_SERVER=0
SKIP_PI=0
SKIP_EXCLI=0
SKIP_PDF=1
INSTALL_TSHARK=0
ASSUME_YES=0

usage() {
  cat <<'USAGE'
Usage: ./scripts/bootstrap.sh [options]

Bootstraps the ExtraHop Investigation Agent on macOS or Linux.
For normal operator startup, run ./start.sh from the repository root.
Do not run with sudo/root; Pi and Claude Code use per-user auth/config.

Options:
  --start        Start the web UI after setup.
  --with-pdf     Install local WeasyPrint support for HTML report PDF export.
  --with-tshark  Attempt to install tshark if it is missing.
  --skip-pi      Do not install/check Pi.
  --skip-excli   Do not install/check excli.
  -y, --yes      Answer yes to non-sensitive prompts.
  -h, --help     Show this help.

excli install inputs, in priority order:
  EXCLI_PATH=/path/to/excli
  EXCLI_ARCHIVE=/path/to/excli-darwin-arm64-*.tar.gz
  EXCLI_URL=https://.../excli-linux-amd64-*.tar.gz
  vendor/excli-<os>-<arch>-*.tar.gz drop-in archives (offline)
  otherwise fetched from the pinned upstream source, checksum-verified
  (see vendor/excli/source.env)

Examples:
  ./start.sh
  EXCLI_URL=https://internal.example/excli-darwin-arm64.tar.gz ./start.sh
  EXCLI_ARCHIVE="$HOME/Downloads/excli-linux-amd64.tar.gz" ./scripts/bootstrap.sh
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start) START_SERVER=1 ;;
    --with-pdf) SKIP_PDF=0 ;;
    --with-tshark) INSTALL_TSHARK=1 ;;
    --skip-pi) SKIP_PI=1 ;;
    --skip-excli) SKIP_EXCLI=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

if [[ "$(id -u)" -eq 0 && "${EH_AGENT_ALLOW_ROOT:-0}" != "1" ]]; then
  cat >&2 <<'ROOT_ERROR'
ERROR: Do not run the ExtraHop Investigation Agent with sudo/root.

Pi and Claude Code store login/provider configuration per user. Running as root
hides your normal user's model/provider config, and Claude Code refuses
bypass-permissions mode when launched with sudo/root privileges.

Run from your normal account instead:
  ./start.sh

If you are intentionally testing as root, set EH_AGENT_ALLOW_ROOT=1.
ROOT_ERROR
  exit 1
fi

log() {
  printf '\n==> %s\n' "$*"
}

die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

have() {
  command -v "$1" >/dev/null 2>&1
}

is_interactive() {
  [[ -t 0 && -t 1 ]]
}

confirm() {
  local prompt="$1"
  if [[ "$ASSUME_YES" -eq 1 ]]; then
    return 0
  fi
  if ! is_interactive; then
    return 1
  fi
  local answer
  read -r -p "$prompt [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]]
}

# True when the running Node satisfies the required >=22.19 (checks minor, not
# just major, so 22.0–22.18 are correctly rejected).
node_version_ok() {
  node -e 'const [maj, min] = process.versions.node.split(".").map(Number); process.exit(maj > 22 || (maj === 22 && min >= 19) ? 0 : 1)' 2>/dev/null
}

install_node_with_brew_if_possible() {
  if [[ "$(uname -s)" == "Darwin" ]] && have brew; then
    if confirm "Node.js 22.19+ was not found. Install Node with Homebrew now?"; then
      brew install node
      return
    fi
  fi
  die "Install Node.js 22.19+ and npm, then rerun this script. macOS: brew install node. Linux: use your distro package manager or https://nodejs.org/."
}

detect_platform() {
  local sys arch
  sys="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="amd64" ;;
    *) return 1 ;;
  esac
  case "$sys" in
    darwin|linux) ;;
    *) return 1 ;;
  esac
  printf '%s-%s\n' "$sys" "$arch"
}

detect_excli_archive() {
  # Loose drop-in archives override the bundled vendor/excli/ release.
  local platform pattern
  platform="$(detect_platform)" || return 0
  pattern="excli-${platform}-*.tar.gz"

  shopt -s nullglob
  # Deliberate globbing: $pattern must stay unquoted so the shell expands the
  # excli-<platform>-*.tar.gz wildcard into the array (nullglob drops no-matches).
  # shellcheck disable=SC2206
  local matches=( "$ROOT_DIR"/vendor/$pattern "$ROOT_DIR"/$pattern "$ROOT_DIR"/../ExtraHop\ CLI*"/"$pattern "$EXCLI_RELEASE_DIR"/$pattern )
  shopt -u nullglob
  if [[ "${#matches[@]}" -gt 0 ]]; then
    printf '%s\n' "${matches[0]}"
  fi
}

verify_excli_checksum() {
  # Release drops ship a sha256 checksums file next to the archives; verify
  # against it when the archive has an entry there.
  local archive="$1"
  local dir base sums expected actual
  dir="$(dirname "$archive")"
  base="$(basename "$archive")"
  shopt -s nullglob
  local sums_files=( "$dir"/excli*checksums*.txt )
  shopt -u nullglob
  [[ "${#sums_files[@]}" -gt 0 ]] || return 0
  sums="${sums_files[0]}"
  expected="$(awk -v f="$base" '$2 == f || $2 == "*" f { print $1; exit }' "$sums")"
  [[ -n "$expected" ]] || return 0
  if have sha256sum; then
    actual="$(sha256sum "$archive" | awk '{ print $1 }')"
  elif have shasum; then
    actual="$(shasum -a 256 "$archive" | awk '{ print $1 }')"
  else
    return 0
  fi
  [[ "$actual" == "$expected" ]] || die "Checksum mismatch for $base against $(basename "$sums"). The archive may be corrupted or incomplete; replace it and rerun."
  log "Verified checksum for $base"
}

ensure_permissions() {
  # Zip round-trips and Windows-mounted filesystems can strip execute bits,
  # forcing manual chmod before anything runs. Restore them up front.
  local file
  for file in "$ROOT_DIR/start.sh" "$ROOT_DIR"/scripts/*.sh "$EXCLI_INTERFACE" "$EXCLI_BINARY"; do
    if [[ -f "$file" ]]; then
      chmod 0755 "$file" 2>/dev/null || true
    fi
  done
  if [[ -f "$ROOT_DIR/.env" ]]; then
    chmod 0600 "$ROOT_DIR/.env" 2>/dev/null || true
  fi
}

install_excli_from_binary() {
  local src="$1"
  [[ -f "$src" ]] || die "EXCLI_PATH does not exist: $src"
  mkdir -p "$ROOT_DIR/bin"
  cp "$src" "$EXCLI_BINARY"
  chmod 0755 "$EXCLI_BINARY"
}

install_excli_from_archive() {
  local archive="$1"
  [[ -f "$archive" ]] || die "excli archive does not exist: $archive"
  verify_excli_checksum "$archive"
  (
    local tmp found
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    tar -xzf "$archive" -C "$tmp"
    found="$(find "$tmp" -type f -name excli -perm -111 -print -quit)"
    if [[ -z "$found" ]]; then
      found="$(find "$tmp" -type f -name excli -print -quit)"
    fi
    [[ -n "$found" ]] || die "Archive did not contain an excli executable: $archive"
    mkdir -p "$ROOT_DIR/bin"
    cp "$found" "$EXCLI_BINARY"
    chmod 0755 "$EXCLI_BINARY"
  )
}

download_excli() {
  local url="$1"
  (
    local tmp out
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    out="$tmp/excli-download"
    log "Downloading excli"
    if have curl; then
      curl -fsSL "$url" -o "$out"
    elif have wget; then
      wget -qO "$out" "$url"
    else
      die "Install curl or wget, or set EXCLI_ARCHIVE/EXCLI_PATH."
    fi
    if tar -tzf "$out" >/dev/null 2>&1; then
      install_excli_from_archive "$out"
    else
      install_excli_from_binary "$out"
    fi
  )
}

clear_excli_quarantine() {
  # Browser-downloaded zips on macOS can mark bundled binaries as quarantined,
  # which causes Gatekeeper dialogs such as "cannot be opened" or "move to Trash".
  # Removing the quarantine attribute is the normal terminal fix for trusted local packages.
  if [[ "$(uname -s)" == "Darwin" ]] && have xattr && [[ -e "$EXCLI_BINARY" ]]; then
    xattr -dr com.apple.quarantine "$EXCLI_BINARY" 2>/dev/null || true
  fi
}

is_excli_interface() {
  [[ -f "$EXCLI_INTERFACE" ]] && grep -q 'EH_EXCLI_BROKER_SOCKET' "$EXCLI_INTERFACE" 2>/dev/null
}

is_legacy_excli_wrapper() {
  [[ -f "$LEGACY_EXCLI_WRAPPER" ]] && grep -q 'EH_EXCLI_BROKER_SOCKET' "$LEGACY_EXCLI_WRAPPER" 2>/dev/null
}

write_excli_interface() {
  cat > "$EXCLI_INTERFACE" <<'WRAPPER'
#!/usr/bin/env node
import net from 'node:net';

const socketPath = process.env.EH_EXCLI_BROKER_SOCKET;

function fail(message, code = 70) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

if (!socketPath) {
  fail('ExtraHop CLI broker is not configured. Run excli-interface from an investigation workspace through the web UI.');
}

const socket = net.createConnection(socketPath);
let buffer = '';
let exitCode = 1;

socket.on('connect', () => {
  socket.write(`${JSON.stringify({
    argv: process.argv.slice(2),
    cwd: process.cwd(),
  })}\n`);
});

socket.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      fail('ExtraHop CLI broker sent an invalid response.');
    }
    if (message.stream === 'stdout' && message.data) {
      process.stdout.write(Buffer.from(message.data, 'base64'));
    } else if (message.stream === 'stderr' && message.data) {
      process.stderr.write(Buffer.from(message.data, 'base64'));
    } else if (message.error) {
      process.stderr.write(`${message.error}\n`);
      exitCode = 1;
    } else if (Object.prototype.hasOwnProperty.call(message, 'exitCode')) {
      exitCode = Number.isInteger(message.exitCode) ? message.exitCode : 1;
    }
  }
});

socket.on('error', (err) => {
  const detail = err.code === 'ENOENT'
    ? 'ExtraHop CLI broker is not running.'
    : err.message;
  fail(detail);
});

socket.on('end', () => process.exit(exitCode));
socket.on('close', () => process.exit(exitCode));
WRAPPER
  chmod 0755 "$EXCLI_INTERFACE"
}

check_excli_interface() {
  if ! is_excli_interface; then
    write_excli_interface
  fi
  [[ -x "$EXCLI_INTERFACE" ]] || die "./excli-interface is missing or not executable."
  is_excli_interface || die "./excli-interface is not the broker interface. Restore the packaged interface before starting the app."
}

install_excli() {
  if [[ ! -x "$EXCLI_BINARY" && -x "$LEGACY_EXCLI_REAL" ]]; then
    log "Renaming legacy bin/excli-real binary to bin/excli"
    mkdir -p "$ROOT_DIR/bin"
    mv "$LEGACY_EXCLI_REAL" "$EXCLI_BINARY"
  fi

  if [[ ! -f "$EXCLI_INTERFACE" && -f "$LEGACY_EXCLI_WRAPPER" ]] && is_legacy_excli_wrapper; then
    log "Renaming legacy root ./excli wrapper to ./excli-interface"
    mv "$LEGACY_EXCLI_WRAPPER" "$EXCLI_INTERFACE"
  fi

  if [[ ! -x "$EXCLI_BINARY" && -x "$LEGACY_EXCLI_WRAPPER" ]] && ! is_legacy_excli_wrapper; then
    log "Moving existing root excli binary to bin/excli"
    mkdir -p "$ROOT_DIR/bin"
    mv "$LEGACY_EXCLI_WRAPPER" "$EXCLI_BINARY"
  fi

  check_excli_interface

  if [[ -f "$LEGACY_EXCLI_WRAPPER" ]] && is_legacy_excli_wrapper; then
    log "Removing legacy root ./excli wrapper"
    rm -f "$LEGACY_EXCLI_WRAPPER"
  fi

  if [[ -f "$EXCLI_BINARY" ]]; then
    chmod 0755 "$EXCLI_BINARY" 2>/dev/null || true
    clear_excli_quarantine
    if "$EXCLI_BINARY" -help >/dev/null 2>&1; then
      log "excli binary already installed"
      return
    fi
    local archive
    if archive="$(detect_excli_archive)" && [[ -n "$archive" ]]; then
      log "bin/excli cannot run on this machine; reinstalling from $(basename "$archive")"
      install_excli_from_archive "$archive"
    else
      log "bin/excli cannot run on this machine; re-fetching from the pinned upstream source"
      bash "$ROOT_DIR/scripts/fetch-excli.sh" "$EXCLI_BINARY" || true
    fi
    clear_excli_quarantine
    "$EXCLI_BINARY" -help >/dev/null 2>&1 || die "bin/excli could not run on this machine ($(uname -s) $(uname -m)). On macOS, if Gatekeeper blocked it, run: xattr -dr com.apple.quarantine ./bin/excli. Otherwise set EXCLI_PATH, EXCLI_ARCHIVE, or EXCLI_URL to a binary built for this platform and rerun."
    return
  fi

  if [[ -n "${EXCLI_PATH:-}" ]]; then
    log "Installing excli from EXCLI_PATH"
    install_excli_from_binary "$EXCLI_PATH"
  elif [[ -n "${EXCLI_ARCHIVE:-}" ]]; then
    log "Installing excli from EXCLI_ARCHIVE"
    install_excli_from_archive "$EXCLI_ARCHIVE"
  elif [[ -n "${EXCLI_URL:-}" ]]; then
    download_excli "$EXCLI_URL"
  else
    local archive
    archive="$(detect_excli_archive || true)"
    if [[ -n "$archive" ]]; then
      log "Installing excli from $(basename "$archive")"
      install_excli_from_archive "$archive"
    else
      # excli is not bundled here: fetch the arch-matched release from the pinned
      # upstream source (checksum-verified). See vendor/excli/source.env.
      log "Fetching excli from the pinned upstream source"
      bash "$ROOT_DIR/scripts/fetch-excli.sh" "$EXCLI_BINARY" \
        || die "Could not fetch excli (offline?). Provide it via EXCLI_PATH, EXCLI_ARCHIVE, or EXCLI_URL, then rerun."
    fi
  fi

  clear_excli_quarantine
  "$EXCLI_BINARY" -help >/dev/null 2>&1 || die "Installed bin/excli could not run. On macOS, if Gatekeeper blocked it, run: xattr -dr com.apple.quarantine ./bin/excli"
}

install_tshark_for_platform() {
  local sys
  sys="$(uname -s)"
  if [[ "$sys" == "Darwin" ]]; then
    if ! have brew; then
      printf 'Homebrew is required for automatic tshark install on macOS. Install Wireshark/tshark manually or install Homebrew.\n' >&2
      return 1
    fi
    brew install wireshark
  elif have apt-get; then
    sudo apt-get update
    sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y tshark
  elif have dnf; then
    sudo dnf install -y wireshark-cli
  elif have yum; then
    sudo yum install -y wireshark
  elif have apk; then
    sudo apk add tshark
  else
    printf 'No supported package manager found. Install tshark/Wireshark manually.\n' >&2
    return 1
  fi
}

check_tshark() {
  if have tshark; then
    log "tshark already installed"
    tshark -v 2>/dev/null | head -1 || true
    return
  fi

  log "tshark not found"
  printf 'tshark is optional but strongly recommended for packet captures downloaded from ExtraHop.\n'
  if [[ "$INSTALL_TSHARK" -eq 1 ]] || confirm "Install tshark now?"; then
    install_tshark_for_platform || true
  fi

  if ! have tshark; then
    cat <<'TSHARK_NOTE'

WARNING: tshark is not installed. The web tool will still run, but packet/PCAP
investigations are much stronger with tshark available.

Install suggestions:
  macOS:  brew install wireshark
  Debian/Ubuntu: sudo apt-get install tshark
  RHEL/Fedora:   sudo dnf install wireshark-cli
TSHARK_NOTE
  fi
}

install_pi() {
  if have pi; then
    log "Pi already installed"
    pi --version >/dev/null 2>&1 || true
    return
  fi
  # Claude Code works as an alternative backend; if it's already here, don't
  # force a Pi install — the app lets you pick the backend in Settings.
  if have claude; then
    log "Pi not found, but Claude Code is installed — skipping Pi install (choose your backend in Settings)"
    return
  fi
  log "Installing Pi coding agent"
  if have npm; then
    npm install -g --ignore-scripts @earendil-works/pi-coding-agent
  elif have curl; then
    curl -fsSL https://pi.dev/install.sh | sh
  else
    die "Install npm or curl, then rerun this script."
  fi
  have pi || die "Pi install finished, but pi is still not on PATH. Open a new shell or update PATH, then rerun."
}

configure_env() {
  if [[ -f "$ROOT_DIR/.env" ]]; then
    return
  fi
  if ! is_interactive; then
    return
  fi
  if ! confirm "Create a local .env with ExtraHop credentials now?"; then
    return
  fi

  local family host
  read -r -p "ExtraHop family (enterprise/rx360) [enterprise]: " family
  family="${family:-enterprise}"
  read -r -p "ExtraHop host: " host
  [[ -n "$host" ]] || die "Host is required to write .env."

  umask 077
  if [[ "$family" == "rx360" ]]; then
    local client_id client_secret
    read -r -p "RevealX 360 client ID: " client_id
    read -r -s -p "RevealX 360 client secret: " client_secret
    printf '\n'
    {
      printf 'EXTRAHOP_HOST=%s\n' "$host"
      printf 'EXTRAHOP_CLIENT_ID=%s\n' "$client_id"
      printf 'EXTRAHOP_CLIENT_SECRET=%s\n' "$client_secret"
    } > "$ROOT_DIR/.env"
  else
    local api_key insecure
    read -r -s -p "RevealX Enterprise API key: " api_key
    printf '\n'
    read -r -p "Skip TLS verification for self-signed certs? [false]: " insecure
    {
      printf 'EXTRAHOP_HOST=%s\n' "$host"
      printf 'EXTRAHOP_API_KEY=%s\n' "$api_key"
      printf 'EXTRAHOP_INSECURE=%s\n' "${insecure:-false}"
    } > "$ROOT_DIR/.env"
  fi
  chmod 0600 "$ROOT_DIR/.env"
  log "Wrote .env"
}

log "Fixing file permissions"
ensure_permissions

log "Checking Node.js"
if ! have node || ! node_version_ok || ! have npm; then
  install_node_with_brew_if_possible
fi

log "Installing Node runtime dependencies"
npm ci --omit=dev

if [[ "$SKIP_PI" -eq 0 ]]; then
  install_pi
fi

if [[ "$SKIP_EXCLI" -eq 0 ]]; then
  install_excli
fi

check_tshark

if [[ "$SKIP_PDF" -eq 0 ]]; then
  log "Installing optional PDF export support"
  npm run setup:python
else
  log "Skipping optional PDF export support"
fi

configure_env

log "Running syntax checks"
npm run check

if [[ "$START_SERVER" -eq 1 ]]; then
  log "Starting ExtraHop Investigation Agent"
  exec npm start
fi

log "Bootstrap complete"
printf 'Start the UI with: ./start.sh\n'
