// OmniPoint Telemetry Store - reactive store via useSyncExternalStore
// Avoids re-rendering the canvas loop on metric updates.

export type WSState = "disconnected" | "connecting" | "connected" | "stopped";
export type GestureKind = "none" | "click" | "drag" | "scroll_up" | "scroll_down";

export interface TelemetrySnapshot {
  fps: number;
  inferenceMs: number;
  confidence: number;
  packetsPerSec: number;
  gesture: GestureKind;
  cursorX: number; // 0..1
  cursorY: number; // 0..1
  wsState: WSState;
  bridgeUrl: string;
  emergencyStop: boolean;
  sensorLost: boolean;
  initialized: boolean;
}

const initial: TelemetrySnapshot = {
  fps: 0,
  inferenceMs: 0,
  confidence: 0,
  packetsPerSec: 0,
  gesture: "none",
  cursorX: 0.5,
  cursorY: 0.5,
  wsState: "disconnected",
  bridgeUrl: "ws://localhost:8765",
  emergencyStop: false,
  sensorLost: false,
  initialized: false,
};

let snapshot: TelemetrySnapshot = { ...initial };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const TelemetryStore = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  get(): TelemetrySnapshot {
    return snapshot;
  },
  set(patch: Partial<TelemetrySnapshot>) {
    snapshot = { ...snapshot, ...patch };
    emit();
  },
};
