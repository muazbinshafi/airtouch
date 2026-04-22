import { useTelemetry } from "@/hooks/useTelemetry";

interface Props {
  onEmergencyToggle: () => void;
}

export function StatusBar({ onEmergencyToggle }: Props) {
  const t = useTelemetry();
  const ledColor =
    t.wsState === "connected"
      ? "text-primary"
      : t.wsState === "connecting"
      ? "text-[hsl(var(--warning))]"
      : t.wsState === "stopped"
      ? "text-destructive"
      : "text-muted-foreground";

  const ledLabel =
    t.wsState === "connected"
      ? "BRIDGE ONLINE"
      : t.wsState === "connecting"
      ? "LINKING..."
      : t.wsState === "stopped"
      ? "HALTED"
      : "BRIDGE OFFLINE";

  return (
    <header className="flex items-center justify-between border-b hairline px-4 h-12 bg-card/60 backdrop-blur">
      <div className="flex items-center gap-6">
        <div className="font-mono text-xs tracking-[0.25em] text-emerald-glow">
          OMNIPOINT // HCI v1.0
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className={`w-2 h-2 rounded-full bg-current led ${ledColor}`} />
          <span className={ledColor}>{ledLabel}</span>
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">
          FPS <span className="text-foreground">{t.fps.toString().padStart(2, "0")}</span>
        </div>
        <div className="font-mono text-[11px] text-muted-foreground">
          INF <span className="text-foreground">{t.inferenceMs.toFixed(1)}ms</span>
        </div>
      </div>
      <button
        onClick={onEmergencyToggle}
        className={`font-mono text-xs tracking-[0.2em] px-4 h-9 border ${
          t.emergencyStop
            ? "border-destructive/60 bg-destructive/10 text-destructive hover:bg-destructive/20"
            : "border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90"
        } led`}
        style={{ boxShadow: t.emergencyStop ? "none" : "0 0 18px hsl(var(--destructive) / 0.6)" }}
      >
        {t.emergencyStop ? "● REARM SYSTEM" : "■ EMERGENCY STOP"}
      </button>
    </header>
  );
}
