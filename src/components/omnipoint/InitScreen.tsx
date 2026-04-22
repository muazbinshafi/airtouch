interface Props {
  status: string;
  progress: number;
  error: string | null;
  onInitialize: () => void;
  initializing: boolean;
}

export function InitScreen({ status, progress, error, onInitialize, initializing }: Props) {
  if (error) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background scan-grid">
        <div className="max-w-xl panel p-8">
          <div className="font-mono text-destructive text-xs tracking-[0.3em] mb-3 led">
            ▲ HARDWARE INITIALIZATION ERROR
          </div>
          <div className="font-mono text-foreground text-sm mb-4 break-words">{error}</div>
          <ul className="font-mono text-[11px] text-muted-foreground space-y-1 mb-6 leading-relaxed">
            <li>• Verify webcam is connected and not in use by another app.</li>
            <li>• Grant camera permission in your browser.</li>
            <li>• Use Chromium / Chrome for GPU MediaPipe delegate.</li>
            <li>• Check network access to MediaPipe CDN.</li>
          </ul>
          <button
            onClick={onInitialize}
            className="font-mono text-[11px] tracking-[0.25em] px-4 h-9 border border-primary text-primary hover:bg-primary/10"
          >
            ⟳ RETRY
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex items-center justify-center bg-background scan-grid">
      <div className="w-[520px] panel p-8">
        <div className="font-mono text-[10px] tracking-[0.4em] text-emerald-glow mb-2">
          OMNIPOINT // HCI
        </div>
        <h1 className="font-mono text-2xl text-foreground tracking-wider mb-1">
          TOUCHLESS INTERFACE
        </h1>
        <p className="font-mono text-[11px] text-muted-foreground tracking-wider mb-8">
          GESTURE-TO-HID BRIDGE · ENTERPRISE EDITION
        </p>

        <div className="border-t border-b hairline py-4 mb-6">
          <div className="grid grid-cols-2 gap-3 font-mono text-[10px]">
            <Spec k="VISION" v="MEDIAPIPE GPU" />
            <Spec k="TARGET" v="60 FPS @ 720P" />
            <Spec k="BRIDGE" v="WS://LOCALHOST:8765" />
            <Spec k="MODEL" v="HAND_LANDMARKER" />
          </div>
        </div>

        <button
          onClick={onInitialize}
          disabled={initializing}
          className="w-full h-12 font-mono text-xs tracking-[0.35em] border border-primary bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-60 disabled:cursor-wait led"
          style={{ boxShadow: "0 0 18px hsl(var(--primary) / 0.4)" }}
        >
          {initializing ? "▶ INITIALIZING..." : "▶ INITIALIZE SENSOR"}
        </button>

        {initializing && (
          <div className="mt-5">
            <div className="font-mono text-[10px] text-muted-foreground tracking-[0.2em] mb-1.5">
              {status}
            </div>
            <div className="h-1 bg-secondary overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress}%`, boxShadow: "0 0 8px hsl(var(--primary))" }}
              />
            </div>
          </div>
        )}

        <p className="mt-6 font-mono text-[10px] text-muted-foreground leading-relaxed">
          Camera access is required. Video is processed locally in your browser; no frames are uploaded.
          For system-wide cursor control on Linux, run the bridge daemon shipped in <span className="text-foreground">bridge/</span>.
        </p>
      </div>
    </div>
  );
}

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-muted-foreground tracking-[0.25em]">{k}</div>
      <div className="text-foreground tracking-[0.15em]">{v}</div>
    </div>
  );
}
