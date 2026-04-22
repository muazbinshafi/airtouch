#!/usr/bin/env bash
# OmniPoint HCI — One-shot Linux installer + launcher.
# Sets up uinput, udev, Python venv, deps, then runs the bridge.
#
# Usage:
#   chmod +x bridge/install_and_run.sh
#   ./bridge/install_and_run.sh
#
# Re-running is safe — every step is idempotent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[omnipoint]${NC} $*"; }
warn() { echo -e "${YELLOW}[omnipoint]${NC} $*"; }
err()  { echo -e "${RED}[omnipoint]${NC} $*" >&2; }

if [[ "$(uname -s)" != "Linux" ]]; then
  err "This script only runs on Linux (need /dev/uinput)."
  exit 1
fi

# ---------------------------------------------------------------------------
# 1. System packages (best-effort; skips if package manager unknown)
# ---------------------------------------------------------------------------
ensure_system_pkgs() {
  local need_pkgs=()
  command -v python3 >/dev/null || need_pkgs+=("python3")
  python3 -m venv --help >/dev/null 2>&1 || need_pkgs+=("python3-venv")
  command -v pip3 >/dev/null || need_pkgs+=("python3-pip")

  if [[ ${#need_pkgs[@]} -eq 0 ]]; then return; fi

  log "Installing system packages: ${need_pkgs[*]}"
  if   command -v apt-get >/dev/null; then sudo apt-get update -y && sudo apt-get install -y "${need_pkgs[@]}"
  elif command -v dnf     >/dev/null; then sudo dnf install -y "${need_pkgs[@]}"
  elif command -v pacman  >/dev/null; then sudo pacman -Sy --noconfirm "${need_pkgs[@]}"
  elif command -v zypper  >/dev/null; then sudo zypper install -y "${need_pkgs[@]}"
  else warn "Unknown package manager — install manually: ${need_pkgs[*]}"
  fi
}
ensure_system_pkgs

# ---------------------------------------------------------------------------
# 2. uinput kernel module + udev rule (system-wide HID without root)
# ---------------------------------------------------------------------------
log "Loading uinput kernel module"
sudo modprobe uinput || warn "modprobe uinput failed (may already be built-in)"

if [[ ! -f /etc/modules-load.d/uinput.conf ]]; then
  log "Persisting uinput module load on boot"
  echo uinput | sudo tee /etc/modules-load.d/uinput.conf >/dev/null
fi

UDEV_RULE=/etc/udev/rules.d/99-uinput.rules
if [[ ! -f "$UDEV_RULE" ]]; then
  log "Installing udev rule for /dev/uinput access"
  sudo tee "$UDEV_RULE" >/dev/null <<'EOF'
KERNEL=="uinput", MODE="0660", GROUP="input", OPTIONS+="static_node=uinput"
EOF
  sudo udevadm control --reload-rules
  sudo udevadm trigger
fi

if ! id -nG "$USER" | tr ' ' '\n' | grep -qx input; then
  log "Adding $USER to 'input' group (log out + back in for it to take effect)"
  sudo usermod -aG input "$USER"
  NEED_RELOGIN=1
else
  NEED_RELOGIN=0
fi

# ---------------------------------------------------------------------------
# 3. Python venv + deps
# ---------------------------------------------------------------------------
VENV="$SCRIPT_DIR/.venv"
if [[ ! -d "$VENV" ]]; then
  log "Creating Python venv at $VENV"
  python3 -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"

log "Installing Python dependencies"
python -m pip install --upgrade pip --quiet
python -m pip install --quiet -r "$SCRIPT_DIR/requirements.txt"

# ---------------------------------------------------------------------------
# 4. Launch
# ---------------------------------------------------------------------------
if [[ "$NEED_RELOGIN" == "1" ]]; then
  warn "You were just added to the 'input' group."
  warn "If the bridge fails with a permission error, log out and back in, then re-run this script."
fi

log "Starting OmniPoint bridge on ws://0.0.0.0:8765 (Ctrl+C to stop)"
exec python "$SCRIPT_DIR/omnipoint_bridge.py"
