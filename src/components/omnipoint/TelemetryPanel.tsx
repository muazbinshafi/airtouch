import { useTelemetry } from "@/hooks/useTelemetry";
import type { EngineConfig } from "@/lib/omnipoint/GestureEngine";

interface Props {
  config: EngineConfig;
  setConfig: (patch: Partial<EngineConfig>) => void;
  bridgeUrl: string;
  setBridgeUrl: (url: string) => void;
  onReconnect: () => void;
}

export function TelemetryPanel({ config, setConfig, bridgeUrl, setBridgeUrl, onReconnect }: Props) {
  const t = useTelemetry();
  return (
    <aside className="flex flex-col panel w-[360px] shrink-0">
      <div className="flex items-center justify-between border-b hairline px-3 h-9">
        <div className="font-mono text-[11px] tracking-[0.25em] text-emerald-glow">
          TELEMETRY // CTRL
        </div>
        <div className="font-mono text-[10px] text-muted-foreground">v1.0</div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-border">
        <Metric label="LATENCY" value={`${t.inferenceMs.toFixed(1)} ms`} />
        <Metric label="CONFIDENCE" value={t.confidence.toFixed(2)} />
        <Metric label="PACKETS/SEC" value={t.packetsPerSec.toString()} />
        <Metric label="FPS" value={t.fps.toString()} />
        <Metric label="GESTURE" value={t.gesture.toUpperCase()} accent />
        <Metric label="WS" value={t.wsState.toUpperCase()} />
      </div>

      <div className="p-3 border-b hairline">
        <SectionTitle>CONFIGURATION</SectionTitle>
        <Slider
          label="SENSITIVITY"
          min={0.5} max={5} step={0.05}
          value={config.sensitivity}
          onChange={(v) => setConfig({ sensitivity: v })}
        />
        <Slider
          label="SMOOTHING α"
          min={0} max={1} step={0.01}
          value={config.smoothingAlpha}
          onChange={(v) => setConfig({ smoothingAlpha: v })}
        />
        <Slider
          label="CLICK THRESHOLD"
          min={0.01} max={0.08} step={0.001}
          value={config.clickThreshold}
          onChange={(v) => setConfig({
            clickThreshold: v,
            releaseThreshold: Math.max(v + 0.005, config.releaseThreshold),
          })}
        />
        <Slider
          label="SCROLL SENSITIVITY"
          min={1} max={50} step={1}
          value={config.scrollSensitivity}
          onChange={(v) => setConfig({ scrollSensitivity: v })}
        />

        <div className="mt-3">
          <div className="font-mono text-[10px] text-muted-foreground mb-1.5 tracking-[0.2em]">ACTIVE ZONE ASPECT</div>
          <div className="grid grid-cols-3 gap-1">
            {[
              { label: "16:9", v: 16 / 9 },
              { label: "16:10", v: 16 / 10 },
              { label: "21:9", v: 21 / 9 },
            ].map((opt) => {
              const active = Math.abs(config.aspectRatio - opt.v) < 0.001;
              return (
                <button
                  key={opt.label}
                  onClick={() => setConfig({ aspectRatio: opt.v })}
                  className={`font-mono text-[11px] h-7 border ${
                    active
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="p-3 border-b hairline">
        <SectionTitle>HID BRIDGE</SectionTitle>
        <label className="font-mono text-[10px] text-muted-foreground tracking-[0.2em]">ENDPOINT</label>
        <input
          value={bridgeUrl}
          onChange={(e) => setBridgeUrl(e.target.value)}
          spellCheck={false}
          className="w-full mt-1 h-8 px-2 bg-input border border-border font-mono text-[12px] text-foreground focus:outline-none focus:border-primary"
        />
        <button
          onClick={onReconnect}
          className="mt-2 w-full h-8 font-mono text-[11px] tracking-[0.2em] border border-primary/60 text-primary hover:bg-primary/10"
        >
          ⟳ RECONNECT
        </button>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Run <span className="text-foreground">bridge/omnipoint_bridge.py</span> on your Linux box to enable system-wide cursor control.
        </p>
      </div>

      <div className="p-3 mt-auto">
        <SectionTitle>GESTURE GUIDE</SectionTitle>
        <ul className="font-mono text-[10px] text-muted-foreground space-y-1 leading-relaxed">
          <li><span className="text-primary">▸</span> INDEX TIP — cursor</li>
          <li><span className="text-primary">▸</span> THUMB+INDEX PINCH — click</li>
          <li><span className="text-primary">▸</span> SUSTAINED PINCH — drag</li>
          <li><span className="text-primary">▸</span> INDEX+MIDDLE UP/DOWN — scroll</li>
        </ul>
      </div>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] tracking-[0.3em] text-emerald-glow mb-2">
      ▣ {children}
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-card p-2.5">
      <div className="font-mono text-[9px] tracking-[0.25em] text-muted-foreground">{label}</div>
      <div className={`font-mono text-base ${accent ? "text-emerald-glow" : "text-foreground"} mt-0.5 tabular-nums`}>
        {value}
      </div>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange }: {
  label: string; min: number; max: number; step: number;
  value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2.5">
      <div className="flex justify-between font-mono text-[10px] tracking-[0.2em] text-muted-foreground">
        <span>{label}</span>
        <span className="text-foreground tabular-nums">{value.toFixed(step < 0.01 ? 3 : 2)}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 mt-1.5 appearance-none bg-secondary accent-primary cursor-pointer"
      />
    </div>
  );
}
