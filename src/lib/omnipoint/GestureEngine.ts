// GestureEngine - MediaPipe HandLandmarker, EMA smoothing, active zone clamp,
// velocity² acceleration, and a strict gesture state machine.

import {
  HandLandmarker,
  FilesetResolver,
  type HandLandmarkerResult,
} from "@mediapipe/tasks-vision";
import { TelemetryStore, type GestureKind } from "./TelemetryStore";
import type { HIDBridge } from "./HIDBridge";

export interface EngineConfig {
  sensitivity: number;       // multiplier for velocity curve (1..5)
  smoothingAlpha: number;    // EMA alpha 0..1 (0 = raw, 1 = heavy)
  clickThreshold: number;    // pinch distance < this triggers click (default 0.03)
  releaseThreshold: number;  // hysteresis (default 0.04)
  scrollSensitivity: number; // pixels per delta unit (1..50)
  aspectRatio: number;       // monitor aspect (e.g. 16/9)
  deadZone: number;          // velocity dead-zone (default 0.0008)
}

export const defaultConfig: EngineConfig = {
  sensitivity: 1.6,
  smoothingAlpha: 0.3,
  clickThreshold: 0.03,
  releaseThreshold: 0.04,
  scrollSensitivity: 12,
  aspectRatio: 16 / 9,
  deadZone: 0.0008,
};

const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

type ClickState = "IDLE" | "CLICK_DOWN" | "DRAG";

export class GestureEngine {
  private landmarker: HandLandmarker | null = null;
  private video: HTMLVideoElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bridge: HIDBridge;
  public config: EngineConfig;

  // EMA state for L4 + L8 (x,y,z)
  private emaThumb: [number, number, number] | null = null;
  private emaIndex: [number, number, number] | null = null;

  // Cursor state (smoothed, post-acceleration), normalized to active zone 0..1
  private cursor = { x: 0.5, y: 0.5 };
  private prevIndex: { x: number; y: number; t: number } | null = null;

  // Active zone center (set via Set Origin)
  private originOffset = { x: 0, y: 0 };

  // Click state machine
  private clickState: ClickState = "IDLE";
  private pinchStartTs = 0;
  private readonly debounceMs = 50;

  // Scroll state
  private lastScrollY: number | null = null;
  private lastScrollEmit = 0;
  private readonly scrollMinIntervalMs = 1000 / 120;

  // FPS / latency
  private frameTimes: number[] = [];
  private running = false;
  private rafId = 0;
  private lastVideoTime = -1;

  constructor(video: HTMLVideoElement, canvas: HTMLCanvasElement, bridge: HIDBridge, config: EngineConfig) {
    this.video = video;
    this.canvas = canvas;
    this.bridge = bridge;
    this.config = config;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
  }

  async init(onProgress?: (msg: string) => void) {
    onProgress?.("Loading vision fileset...");
    const fileset = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm",
    );
    onProgress?.("Loading HandLandmarker model...");
    this.landmarker = await HandLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU",
      },
      numHands: 1,
      runningMode: "VIDEO",
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    onProgress?.("Sensor ready.");
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.tick();
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  setOrigin() {
    if (!this.emaIndex) return;
    this.originOffset.x = this.emaIndex[0] - 0.5;
    this.originOffset.y = this.emaIndex[1] - 0.5;
  }

  private ema(prev: [number, number, number] | null, cur: [number, number, number], alpha: number): [number, number, number] {
    if (!prev) return cur;
    // alpha = smoothing strength: higher = more smoothing => weight previous more.
    const a = Math.min(1, Math.max(0, alpha));
    return [
      prev[0] * a + cur[0] * (1 - a),
      prev[1] * a + cur[1] * (1 - a),
      prev[2] * a + cur[2] * (1 - a),
    ];
  }

  private tick() {
    if (!this.landmarker || this.video.readyState < 2) return;
    const tNow = performance.now();
    if (this.video.currentTime === this.lastVideoTime) {
      this.draw(null);
      return;
    }
    this.lastVideoTime = this.video.currentTime;

    const t0 = performance.now();
    const result = this.landmarker.detectForVideo(this.video, tNow);
    const inferMs = performance.now() - t0;

    // FPS calc
    this.frameTimes.push(tNow);
    while (this.frameTimes.length && tNow - this.frameTimes[0] > 1000) this.frameTimes.shift();

    const snap = TelemetryStore.get();
    if (snap.emergencyStop) {
      this.draw(result);
      return;
    }

    let confidence = 0;
    if (result.landmarks.length > 0) {
      // handedness score as proxy for confidence
      confidence = result.handedness?.[0]?.[0]?.score ?? 0.8;
      this.processLandmarks(result, tNow);
    } else {
      confidence = 0;
      this.emaIndex = null;
      this.emaThumb = null;
      this.prevIndex = null;
      this.clickState = "IDLE";
      this.lastScrollY = null;
    }

    const sensorLost = confidence < 0.5;
    TelemetryStore.set({
      fps: this.frameTimes.length,
      inferenceMs: inferMs,
      confidence,
      sensorLost,
    });

    this.draw(result);
  }

  private processLandmarks(result: HandLandmarkerResult, tNow: number) {
    const lm = result.landmarks[0];
    const thumbTip = lm[4];
    const indexTip = lm[8];
    const middleTip = lm[12];
    const ringTip = lm[16];
    const pinkyTip = lm[20];
    const indexPip = lm[6];
    const middlePip = lm[10];
    const ringPip = lm[14];
    const pinkyPip = lm[18];
    const wrist = lm[0];

    // EMA smoothing on 4 + 8 only
    const aRaw: [number, number, number] = [thumbTip.x, thumbTip.y, thumbTip.z];
    const bRaw: [number, number, number] = [indexTip.x, indexTip.y, indexTip.z];
    this.emaThumb = this.ema(this.emaThumb, aRaw, this.config.smoothingAlpha);
    this.emaIndex = this.ema(this.emaIndex, bRaw, this.config.smoothingAlpha);

    const ix = this.emaIndex[0];
    const iy = this.emaIndex[1];

    // Active zone: clamp to monitor aspect ratio centered at origin offset
    // Camera viewport is [0..1] x [0..1] (normalized). Build the largest rect
    // with this.config.aspectRatio that fits. Camera input aspect ~16:9 already.
    const camAspect = this.canvas.width / this.canvas.height || 16 / 9;
    let zoneW = 1;
    let zoneH = 1;
    if (this.config.aspectRatio >= camAspect) {
      zoneW = 1;
      zoneH = camAspect / this.config.aspectRatio;
    } else {
      zoneH = 1;
      zoneW = this.config.aspectRatio / camAspect;
    }
    const cx = 0.5 + this.originOffset.x;
    const cy = 0.5 + this.originOffset.y;
    const zx0 = cx - zoneW / 2;
    const zy0 = cy - zoneH / 2;

    // Mirror X (selfie view): cursor right when hand moves right in mirror.
    const mirroredX = 1 - ix;
    const inZoneX = (mirroredX - zx0) / zoneW;
    const inZoneY = (iy - zy0) / zoneH;

    if (inZoneX < 0 || inZoneX > 1 || inZoneY < 0 || inZoneY > 1) {
      // Out of active zone -> stop motion but still emit gesture state
      this.emitMotion("none", 0);
      return;
    }

    // Velocity² acceleration with dead-zone, applied to delta from previous index sample.
    let cx2 = inZoneX;
    let cy2 = inZoneY;
    if (this.prevIndex) {
      const dt = Math.max(1, tNow - this.prevIndex.t) / 1000;
      const dx = inZoneX - this.prevIndex.x;
      const dy = inZoneY - this.prevIndex.y;
      const speed = Math.hypot(dx, dy) / dt;
      if (speed < this.config.deadZone) {
        cx2 = this.cursor.x;
        cy2 = this.cursor.y;
      } else {
        const accel = speed * this.config.sensitivity;
        const gain = Math.max(1, accel); // V_cursor = V_hand² (squared via speed*sensitivity)
        cx2 = this.cursor.x + dx * gain;
        cy2 = this.cursor.y + dy * gain;
      }
    }
    this.cursor.x = Math.min(1, Math.max(0, cx2));
    this.cursor.y = Math.min(1, Math.max(0, cy2));
    this.prevIndex = { x: inZoneX, y: inZoneY, t: tNow };

    // Pinch distance (3D Euclidean)
    const dx = this.emaThumb[0] - this.emaIndex[0];
    const dy = this.emaThumb[1] - this.emaIndex[1];
    const dz = this.emaThumb[2] - this.emaIndex[2];
    const pinch = Math.hypot(dx, dy, dz);
    const pressure = Math.min(1, Math.max(0, 1 - pinch / 0.15));

    // Scroll detection: index+middle extended, ring+pinky folded
    const indexExt = indexTip.y < indexPip.y - 0.02;
    const middleExt = middleTip.y < middlePip.y - 0.02;
    const ringFold = ringTip.y > ringPip.y - 0.005;
    const pinkyFold = pinkyTip.y > pinkyPip.y - 0.005;
    const scrollMode = indexExt && middleExt && ringFold && pinkyFold;
    void wrist;

    let gesture: GestureKind = "none";

    if (scrollMode) {
      // Scroll: vertical delta of index tip
      if (this.lastScrollY != null) {
        const sdy = iy - this.lastScrollY;
        if (Math.abs(sdy) > 0.003 && tNow - this.lastScrollEmit >= this.scrollMinIntervalMs) {
          gesture = sdy < 0 ? "scroll_up" : "scroll_down";
          this.lastScrollEmit = tNow;
        }
      }
      this.lastScrollY = iy;
      this.clickState = "IDLE";
    } else {
      this.lastScrollY = null;
      // Click / drag state machine with hysteresis + debounce
      if (this.clickState === "IDLE") {
        if (pinch < this.config.clickThreshold) {
          if (this.pinchStartTs === 0) this.pinchStartTs = tNow;
          if (tNow - this.pinchStartTs >= this.debounceMs) {
            this.clickState = "CLICK_DOWN";
            gesture = "click";
          }
        } else {
          this.pinchStartTs = 0;
        }
      } else if (this.clickState === "CLICK_DOWN") {
        if (pinch >= this.config.releaseThreshold) {
          this.clickState = "IDLE";
          this.pinchStartTs = 0;
          gesture = "none";
        } else {
          // Sustained pinch -> drag
          gesture = "drag";
          this.clickState = "DRAG";
        }
      } else if (this.clickState === "DRAG") {
        if (pinch >= this.config.releaseThreshold) {
          this.clickState = "IDLE";
          this.pinchStartTs = 0;
          gesture = "none";
        } else {
          gesture = "drag";
        }
      }
    }

    TelemetryStore.set({
      cursorX: this.cursor.x,
      cursorY: this.cursor.y,
      gesture,
    });

    this.emitMotion(gesture, pressure);
  }

  private emitMotion(gesture: GestureKind, pressure: number) {
    this.bridge.send({
      event: "motion",
      data: {
        x: this.cursor.x,
        y: this.cursor.y,
        pressure,
        gesture,
      },
      timestamp: Date.now(),
    });
  }

  private draw(result: HandLandmarkerResult | null) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Active zone box (mirrored to match mirrored video)
    const camAspect = w / h || 16 / 9;
    let zoneW = 1, zoneH = 1;
    if (this.config.aspectRatio >= camAspect) {
      zoneH = camAspect / this.config.aspectRatio;
    } else {
      zoneW = this.config.aspectRatio / camAspect;
    }
    const cx = 0.5 + this.originOffset.x;
    const cy = 0.5 + this.originOffset.y;
    const zx0 = (cx - zoneW / 2) * w;
    const zy0 = (cy - zoneH / 2) * h;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 1;
    ctx.strokeRect(zx0, zy0, zoneW * w, zoneH * h);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("ACTIVE ZONE", zx0 + 6, zy0 + 14);
    ctx.restore();

    if (!result || result.landmarks.length === 0) return;

    const lm = result.landmarks[0];
    // Mirror landmarks horizontally to match mirrored video
    const pts = lm.map((p) => ({ x: (1 - p.x) * w, y: p.y * h }));

    // Bones
    ctx.strokeStyle = "hsl(160 84% 50%)";
    ctx.lineWidth = 2;
    ctx.shadowColor = "hsl(160 84% 50%)";
    ctx.shadowBlur = 6;
    for (const [a, b] of HAND_CONNECTIONS) {
      ctx.beginPath();
      ctx.moveTo(pts[a].x, pts[a].y);
      ctx.lineTo(pts[b].x, pts[b].y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Joints
    ctx.fillStyle = "hsl(160 84% 60%)";
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Highlight thumb (4) and index (8)
    ctx.fillStyle = "white";
    for (const i of [4, 8]) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cursor crosshair (in active zone -> camera coords)
    const curCamX = (zx0 + this.cursor.x * zoneW * w);
    const curCamY = (zy0 + this.cursor.y * zoneH * h);
    ctx.strokeStyle = "hsl(160 84% 60%)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(curCamX - 10, curCamY);
    ctx.lineTo(curCamX + 10, curCamY);
    ctx.moveTo(curCamX, curCamY - 10);
    ctx.lineTo(curCamX, curCamY + 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(curCamX, curCamY, 6, 0, Math.PI * 2);
    ctx.stroke();
  }
}
