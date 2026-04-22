# OmniPoint HCI — Enterprise Touchless Interface System

Control your **entire Linux PC with hand gestures**. OmniPoint is a Gesture-to-HID
bridge: the browser app uses MediaPipe to track your hand at 60 FPS, and a tiny
local daemon injects real mouse events into your OS so the cursor moves
**system-wide** — desktop, browsers, terminals, games, everything.

```
 ┌─────────────────────────┐         ┌──────────────────────────┐
 │  Browser (Chromium)     │  WS     │  Linux Bridge Daemon     │
 │  Webcam + MediaPipe     │ ──────► │  python-uinput (HID)     │
 │  Gesture engine + UI    │  JSON   │  Moves real OS cursor    │
 │                         │ :8765   │  Click / drag / scroll   │
 └─────────────────────────┘         └──────────────────────────┘
```

## Quick start

### 1. Run the Linux bridge daemon (does the actual cursor control)

```bash
cd bridge
sudo modprobe uinput
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 omnipoint_bridge.py
```

See [`bridge/README.md`](./bridge/README.md) for the full setup including the
udev rule for non-root access and a `systemd --user` autostart unit.

### 2. Open the web app

In Chromium, open the deployed app (or `npm run dev` for local), click
**INITIALIZE SENSOR**, and grant camera access. The WS LED in the top bar will
turn green when the bridge is reached.

### 3. Use it

| Gesture | Action |
|---------|--------|
| Index finger movement | Move cursor |
| Pinch thumb + index   | Left click |
| Sustained pinch       | Drag |
| Index + middle up/down | Scroll wheel |
| Hit **EMERGENCY STOP** | Instantly release all input |

## Architecture

- `src/lib/omnipoint/GestureEngine.ts` — MediaPipe HandLandmarker, EMA smoothing
  on landmarks 4 & 8, active-zone clamp, velocity² acceleration, click/drag/scroll
  state machine with hysteresis + debounce.
- `src/lib/omnipoint/HIDBridge.ts` — Persistent WebSocket with exponential
  backoff (250 ms → 8 s), 5 s heartbeat, emergency kill-switch.
- `src/lib/omnipoint/TelemetryStore.ts` — Reactive store via `useSyncExternalStore`
  so live metrics never re-render the canvas loop.
- `bridge/omnipoint_bridge.py` — Python daemon. Uses kernel `uinput` (X11 + Wayland)
  with `pynput` fallback.

## Performance targets

- 60 FPS at 1280×720 input
- < 16.6 ms per frame end-to-end
- GPU MediaPipe delegate
- 240 Hz move / 120 Hz scroll rate limits at the daemon

## Web stack

React 18 · Vite 5 · TypeScript 5 · Tailwind CSS · `@mediapipe/tasks-vision`.
