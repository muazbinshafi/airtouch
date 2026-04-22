#!/usr/bin/env python3
"""
OmniPoint HCI — Linux HID Bridge Daemon
=======================================

Receives normalized gesture/cursor packets over WebSocket from the OmniPoint
browser app and injects real OS-level mouse events on Linux.

Backends (auto-selected, in order):
  1) python-uinput  -> kernel /dev/uinput, works on X11 AND Wayland.
  2) pynput          -> X11 fallback (Wayland: limited / may not work).

Run:
  sudo modprobe uinput          # one time
  pip install -r requirements.txt
  python3 omnipoint_bridge.py

Listening on: ws://0.0.0.0:8765
Payload schema (from browser):
  {
    "event": "motion",
    "data": {
      "x": 0..1, "y": 0..1, "pressure": 0..1,
      "gesture": "none" | "click" | "drag" | "scroll_up" | "scroll_down"
    },
    "timestamp": <ms>
  }
"""

import asyncio
import json
import logging
import sys
import time
from typing import Optional

try:
    import websockets
except ImportError:
    print("Missing dep: pip install websockets", file=sys.stderr)
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("omnipoint")

HOST = "0.0.0.0"
PORT = 8765
IDLE_TIMEOUT_S = 2.0          # safety: ignore stale streams
SCROLL_RATE_LIMIT_HZ = 120
MOVE_RATE_LIMIT_HZ = 240


# ---------------------------------------------------------------------------
# Screen size detection
# ---------------------------------------------------------------------------
def get_screen_size() -> tuple[int, int]:
    # Try Xlib (X11)
    try:
        from Xlib import display  # type: ignore
        d = display.Display()
        s = d.screen()
        return s.width_in_pixels, s.height_in_pixels
    except Exception:
        pass
    # Try tkinter
    try:
        import tkinter
        r = tkinter.Tk()
        r.withdraw()
        w, h = r.winfo_screenwidth(), r.winfo_screenheight()
        r.destroy()
        return w, h
    except Exception:
        pass
    log.warning("Could not detect screen size; defaulting to 1920x1080")
    return 1920, 1080


# ---------------------------------------------------------------------------
# Backends
# ---------------------------------------------------------------------------
class Backend:
    name = "base"
    def move(self, x: int, y: int) -> None: ...
    def left_down(self) -> None: ...
    def left_up(self) -> None: ...
    def scroll(self, dy: int) -> None: ...


class UInputBackend(Backend):
    """Kernel-level HID via /dev/uinput. Works on X11 + Wayland."""
    name = "uinput"

    def __init__(self, screen_w: int, screen_h: int):
        import uinput  # type: ignore
        self.uinput = uinput
        self.screen_w = screen_w
        self.screen_h = screen_h
        events = (
            uinput.ABS_X + (0, screen_w, 0, 0),
            uinput.ABS_Y + (0, screen_h, 0, 0),
            uinput.BTN_LEFT,
            uinput.BTN_RIGHT,
            uinput.REL_WHEEL,
        )
        self.device = uinput.Device(events, name="omnipoint-hid")
        time.sleep(0.2)  # let udev settle

    def move(self, x: int, y: int) -> None:
        self.device.emit(self.uinput.ABS_X, x, syn=False)
        self.device.emit(self.uinput.ABS_Y, y, syn=True)

    def left_down(self) -> None:
        self.device.emit(self.uinput.BTN_LEFT, 1)

    def left_up(self) -> None:
        self.device.emit(self.uinput.BTN_LEFT, 0)

    def scroll(self, dy: int) -> None:
        self.device.emit(self.uinput.REL_WHEEL, dy)


class PynputBackend(Backend):
    """Userspace fallback (X11 reliable; Wayland generally not)."""
    name = "pynput"

    def __init__(self, screen_w: int, screen_h: int):
        from pynput.mouse import Controller, Button  # type: ignore
        self._ctrl = Controller()
        self._Button = Button
        self.screen_w = screen_w
        self.screen_h = screen_h

    def move(self, x: int, y: int) -> None:
        self._ctrl.position = (x, y)

    def left_down(self) -> None:
        self._ctrl.press(self._Button.left)

    def left_up(self) -> None:
        self._ctrl.release(self._Button.left)

    def scroll(self, dy: int) -> None:
        # pynput scroll is in "click" units; positive = up.
        self._ctrl.scroll(0, dy)


def make_backend() -> Backend:
    sw, sh = get_screen_size()
    log.info(f"Screen detected: {sw}x{sh}")
    try:
        b = UInputBackend(sw, sh)
        log.info("Using kernel uinput backend (system-wide HID).")
        return b
    except Exception as e:
        log.warning(f"uinput unavailable ({e}); falling back to pynput.")
    try:
        b = PynputBackend(sw, sh)
        log.info("Using pynput backend.")
        return b
    except Exception as e:
        log.error(f"No HID backend available: {e}")
        raise


# ---------------------------------------------------------------------------
# Session controller
# ---------------------------------------------------------------------------
class Session:
    def __init__(self, backend: Backend):
        self.backend = backend
        self.left_pressed = False
        self.last_move_ts = 0.0
        self.last_scroll_ts = 0.0
        self.last_packet_ts = time.monotonic()
        self.last_x: Optional[int] = None
        self.last_y: Optional[int] = None

    def handle(self, msg: dict) -> None:
        evt = msg.get("event")
        if evt == "heartbeat":
            self.last_packet_ts = time.monotonic()
            return
        if evt != "motion":
            return
        data = msg.get("data") or {}
        gesture = data.get("gesture", "none")
        x_n = float(data.get("x", 0.5))
        y_n = float(data.get("y", 0.5))
        x_n = max(0.0, min(1.0, x_n))
        y_n = max(0.0, min(1.0, y_n))

        now = time.monotonic()
        self.last_packet_ts = now

        # Motion (rate-limited)
        if now - self.last_move_ts >= 1.0 / MOVE_RATE_LIMIT_HZ:
            x_px = int(x_n * self.backend.screen_w)
            y_px = int(y_n * self.backend.screen_h)
            if (x_px, y_px) != (self.last_x, self.last_y):
                self.backend.move(x_px, y_px)
                self.last_x, self.last_y = x_px, y_px
            self.last_move_ts = now

        # Click / Drag state
        if gesture == "click" or gesture == "drag":
            if not self.left_pressed:
                self.backend.left_down()
                self.left_pressed = True
                log.debug("LEFT DOWN")
        else:
            if self.left_pressed:
                self.backend.left_up()
                self.left_pressed = False
                log.debug("LEFT UP")

        # Scroll
        if gesture in ("scroll_up", "scroll_down"):
            if now - self.last_scroll_ts >= 1.0 / SCROLL_RATE_LIMIT_HZ:
                self.backend.scroll(1 if gesture == "scroll_up" else -1)
                self.last_scroll_ts = now

    def safety_release(self) -> None:
        if self.left_pressed:
            try:
                self.backend.left_up()
            except Exception:
                pass
            self.left_pressed = False


# ---------------------------------------------------------------------------
# WebSocket server
# ---------------------------------------------------------------------------
async def watchdog(session: Session) -> None:
    while True:
        await asyncio.sleep(0.5)
        if time.monotonic() - session.last_packet_ts > IDLE_TIMEOUT_S:
            session.safety_release()


async def handler(ws, backend: Backend):
    log.info(f"Client connected: {ws.remote_address}")
    session = Session(backend)
    wd = asyncio.create_task(watchdog(session))
    try:
        async for raw in ws:
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            try:
                session.handle(msg)
            except Exception as e:
                log.exception(f"handle error: {e}")
    except websockets.ConnectionClosed:
        pass
    finally:
        wd.cancel()
        session.safety_release()
        log.info("Client disconnected.")


async def main() -> None:
    backend = make_backend()
    async with websockets.serve(lambda ws: handler(ws, backend), HOST, PORT, max_size=2**16):
        log.info(f"OmniPoint bridge listening on ws://{HOST}:{PORT}")
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Shutting down.")
