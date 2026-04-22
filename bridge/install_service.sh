#!/usr/bin/env bash
# Install the OmniPoint bridge as a system-wide systemd service.
# Auto-starts at boot, restarts on failure, runs as your user.
#
# Usage:
#   ./bridge/install_service.sh           # install + enable + start
#   ./bridge/install_service.sh --uninstall
#
# Re-running is safe — idempotent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="omnipoint-bridge.service"
SERVICE_DST="/etc/systemd/system/${SERVICE_NAME}"
SERVICE_SRC="${SCRIPT_DIR}/omnipoint-bridge.service"
RUN_USER="${SUDO_USER:-$USER}"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[omnipoint]${NC} $*"; }
warn() { echo -e "${YELLOW}[omnipoint]${NC} $*"; }
err()  { echo -e "${RED}[omnipoint]${NC} $*" >&2; }

if [[ "$(uname -s)" != "Linux" ]]; then
  err "systemd install only works on Linux."; exit 1
fi
if ! command -v systemctl >/dev/null; then
  err "systemctl not found — this distro doesn't use systemd."; exit 1
fi

if [[ "${1:-}" == "--uninstall" ]]; then
  log "Stopping and disabling ${SERVICE_NAME}"
  sudo systemctl disable --now "${SERVICE_NAME}" 2>/dev/null || true
  sudo rm -f "${SERVICE_DST}"
  sudo systemctl daemon-reload
  log "Uninstalled."
  exit 0
fi

# ---------------------------------------------------------------------------
# 1. Make sure the bridge itself is set up (venv + deps + uinput + udev)
# ---------------------------------------------------------------------------
if [[ ! -x "${SCRIPT_DIR}/.venv/bin/python" ]]; then
  log "Bridge venv not found — running install_and_run.sh setup steps first"
  # Run the installer but skip the final exec by sourcing pieces we need.
  # Easiest: just call it and let user Ctrl+C once it starts; instead we run
  # a non-launching subshell.
  bash -c "
    set -e
    cd '${SCRIPT_DIR}'
    # Re-use install_and_run.sh up to (but not including) the final exec by
    # running it with a trap that exits before launch.
    OMNIPOINT_SETUP_ONLY=1 bash '${SCRIPT_DIR}/install_and_run.sh' || true
  " || true
fi

# Fallback: ensure venv exists even if the above didn't run setup-only mode.
if [[ ! -x "${SCRIPT_DIR}/.venv/bin/python" ]]; then
  log "Creating Python venv"
  python3 -m venv "${SCRIPT_DIR}/.venv"
  "${SCRIPT_DIR}/.venv/bin/python" -m pip install --upgrade pip --quiet
  "${SCRIPT_DIR}/.venv/bin/python" -m pip install --quiet -r "${SCRIPT_DIR}/requirements.txt"
fi

# ---------------------------------------------------------------------------
# 2. Render unit file with this user + bridge path
# ---------------------------------------------------------------------------
log "Installing ${SERVICE_NAME} for user '${RUN_USER}' (bridge dir: ${SCRIPT_DIR})"
TMP_UNIT="$(mktemp)"
sed -e "s|__USER__|${RUN_USER}|g" \
    -e "s|__BRIDGE_DIR__|${SCRIPT_DIR}|g" \
    "${SERVICE_SRC}" > "${TMP_UNIT}"
sudo install -m 0644 "${TMP_UNIT}" "${SERVICE_DST}"
rm -f "${TMP_UNIT}"

# ---------------------------------------------------------------------------
# 3. Enable + start
# ---------------------------------------------------------------------------
sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}"
sudo systemctl restart "${SERVICE_NAME}"

sleep 1
log "Status:"
sudo systemctl --no-pager --full status "${SERVICE_NAME}" | head -n 20 || true

cat <<EOF

${GREEN}Installed.${NC} The bridge will now auto-start at boot and restart on failure.

  View live logs : journalctl -u ${SERVICE_NAME} -f
  Stop           : sudo systemctl stop ${SERVICE_NAME}
  Disable boot   : sudo systemctl disable ${SERVICE_NAME}
  Uninstall      : ./bridge/install_service.sh --uninstall
EOF
