
# OmniPoint HCI — System-Wide Gesture Control for Linux PC

Your goal: control the **entire PC** (any app, any window) with hand gestures alone. The browser is only the *sensor + brain*; a local Linux daemon is the *hands* that move the real OS cursor.

## Architecture (two parts working together)

```text
 ┌─────────────────────────┐         ┌──────────────────────────┐
 │  Browser (Chromium)     │  WS     │  Linux Bridge Daemon     │
 │  - Webcam + MediaPipe   │ ──────► │  - python-uinput (HID)   │
 │  - Gesture engine       │  JSON   │  - Moves real OS cursor  │
 │  - Telemetry UI         │ :8765   │  - Click / drag / scroll │
 └─────────────────────────┘         └──────────────────────────┘
        runs in Lovable preview            runs on your Linux box
```

The browser app keeps running in a small always-on-top window (or background tab); the daemon injects events into `/dev/uinput`, so the cursor moves **system-wide** — desktop, browsers, terminals, games, everything.

## Part A — Web App (built in Lovable)

Single-page React/TS app, "Deep Space" theme (`#050505` bg, `#10b981` accent, `font-mono` telemetry).

**Screens**
1. **Init screen** — "INITIALIZE SENSOR" button → camera permission + MediaPipe model load with progress. Failure → full-screen "HARDWARE INITIALIZATION ERROR".
2. **Main console**
   - Top bar: WS connection LED, FPS, big red **EMERGENCY STOP** (kill-switch checked every frame and before every send).
   - Left: 1280×720 video (opacity 0.9) + canvas skeletal overlay (emerald bones, 2px joints, sub-pixel) + Active Zone box + "SET ORIGIN" button + "SENSOR LOST" overlay when confidence < 0.5.
   - Right: live telemetry (latency ms, confidence, packets/sec, current gesture, cursor x/y) + sliders (Sensitivity, Smoothing α=0.3, Click Threshold=0.03, Scroll Sensitivity, Active Zone aspect 16:9 / 16:10 / 21:9) + Bridge URL field + Reconnect.

**Engine modules**
- `GestureEngine.ts` — HandLandmarker (`runningMode:"VIDEO"`, GPU delegate, 1 hand). Normalize to [0,1]. EMA smoothing on L4 + L8 only. Active-zone clamp to monitor aspect. Velocity² acceleration with dead-zone.
- **State machine**: pinch (3D dist L4↔L8 < 0.03, 50 ms debounce) → click; hysteresis release > 0.04 → drag; index+middle extended & ring+pinky folded → scroll (vertical Δ of L8, capped 120 ev/s).
- `HIDBridge.ts` — WebSocket to `ws://localhost:8765`, exponential backoff (250 ms → 8 s), 5 s heartbeat. Payload exactly:
  ```json
  {"event":"motion","data":{"x":0-1,"y":0-1,"pressure":0-1,"gesture":"none|click|drag|scroll_up|scroll_down"},"timestamp":<ms>}
  ```
- `TelemetryStore.ts` — `useSyncExternalStore` reactive store so the canvas loop never re-renders React.
- Uses `requestVideoFrameCallback` for inference, `requestAnimationFrame` for drawing, target < 16.6 ms/frame.

## Part B — Linux Bridge Daemon (shipped in `bridge/` folder)

This is what makes it control your **whole PC**, not just the browser.

- `bridge/omnipoint_bridge.py` — Python 3 server: `websockets` + **`python-uinput`** (true kernel HID via `/dev/uinput`, works on both X11 and Wayland). Falls back to `pynput` if uinput unavailable.
- Reads monitor resolution via `Xlib` / `randr`; maps normalized (x,y) → absolute screen pixels. Applies `gesture` field to emit `BTN_LEFT` press/release, drag (sustained press + move), and `REL_WHEEL` for scroll.
- Hard rate limits + safety: ignores motion when `gesture="emergency_stop"` or socket idle > 2 s.
- `bridge/requirements.txt`, `bridge/README.md` with:
  - `sudo modprobe uinput`
  - udev rule (`/etc/udev/rules.d/99-uinput.rules`) so it runs without root
  - `pip install -r requirements.txt`
  - `python omnipoint_bridge.py`
  - Optional `systemd --user` unit for autostart on login.

## Recommended usage flow
1. On your Linux PC: clone repo → run the Python bridge once (autostarts after).
2. Open the deployed web app in Chromium → click **INITIALIZE SENSOR** → grant camera.
3. WS LED turns green → move your index finger → real OS cursor moves anywhere on your screen. Pinch to click. Two-finger up/down to scroll. Sustained pinch to drag windows/files.
4. EMERGENCY STOP (or close the tab) instantly halts all OS input.

## Deliverables in this build
- Full SPA at `/` with init screen, sensor view, telemetry, all sliders, emergency stop, WS bridge with reconnect.
- `bridge/omnipoint_bridge.py` + `requirements.txt` + setup README for Linux system-wide control.
- README at repo root documenting the end-to-end flow.
