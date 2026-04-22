# OmniPoint HCI — Linux HID Bridge

This daemon turns the OmniPoint browser app into **system-wide** cursor control.
The browser does the vision; this process injects real mouse events into your OS.

## 0. One-shot install + run (recommended)

```bash
chmod +x bridge/install_and_run.sh
./bridge/install_and_run.sh
```

This single script installs system packages, loads `uinput`, writes the udev
rule, adds you to the `input` group, creates a Python venv, installs deps, and
launches the bridge. It is idempotent — safe to re-run any time.

The manual steps below are kept for reference.

## 1. One-time host setup (Linux)

```bash
# Load the uinput kernel module (needed for true HID, X11 + Wayland)
sudo modprobe uinput
echo uinput | sudo tee /etc/modules-load.d/uinput.conf

# Allow your user to write to /dev/uinput without sudo
sudo tee /etc/udev/rules.d/99-uinput.rules >/dev/null <<'EOF'
KERNEL=="uinput", MODE="0660", GROUP="input", OPTIONS+="static_node=uinput"
EOF
sudo usermod -aG input "$USER"
sudo udevadm control --reload-rules && sudo udevadm trigger
# Log out + back in for the group change to take effect.
```

## 2. Install Python deps

```bash
cd bridge
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## 3. Run

```bash
python3 omnipoint_bridge.py
# -> OmniPoint bridge listening on ws://0.0.0.0:8765
```

Open the OmniPoint web app in Chromium, click **INITIALIZE SENSOR**, grant the
camera, and the WS LED will turn green. Move your **index finger** — the real
OS cursor moves anywhere on your desktop. Pinch thumb+index to click, hold to
drag, raise index+middle and move up/down to scroll.

## 4. Autostart at boot (recommended, system-wide systemd)

```bash
./bridge/install_service.sh         # install, enable, and start
journalctl -u omnipoint-bridge -f   # follow live logs
./bridge/install_service.sh --uninstall
```

The unit lives at `/etc/systemd/system/omnipoint-bridge.service`, runs as your
user with the `input` group, calls `modprobe uinput` first, and is set to
`Restart=on-failure` (2 s backoff, 10 retries / 60 s).

## 4b. Autostart on login only (alternative, systemd --user)

`~/.config/systemd/user/omnipoint-bridge.service`:

```ini
[Unit]
Description=OmniPoint HCI HID Bridge
After=graphical-session.target

[Service]
Type=simple
ExecStart=%h/path/to/bridge/.venv/bin/python %h/path/to/bridge/omnipoint_bridge.py
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now omnipoint-bridge.service
```

## 5. Backends

| Backend     | Display server   | System-wide |
|-------------|------------------|-------------|
| `uinput`    | X11 + Wayland    | ✅          |
| `pynput`    | X11 (fallback)   | ⚠️ X11 only |

The daemon auto-selects `uinput` when available.

## 6. Safety

- **Idle watchdog**: if no packet arrives for 2 s, any held mouse button is released.
- **EMERGENCY STOP** in the web app closes the WebSocket → daemon releases buttons immediately.
- **Rate limits**: 240 Hz move, 120 Hz scroll.

## 7. Protocol

Inbound JSON:
```json
{
  "event": "motion",
  "data": { "x": 0.0-1.0, "y": 0.0-1.0, "pressure": 0.0-1.0,
            "gesture": "none|click|drag|scroll_up|scroll_down" },
  "timestamp": 1700000000000
}
```
Heartbeats: `{"event":"heartbeat","timestamp":<ms>}`.
