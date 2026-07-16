/**
 * NativeDiagnostics — diagnostikpanel synlig på native (iOS/Android).
 *
 * Visar plattform, behörighetsstatus, nuvarande route och eventuella native-fel.
 * Minimeras till en liten knapp tills användaren trycker för att expandera.
 * Uppdateras var 2:a sekund.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { type NativeDiagnosticsData, getNativeDiagnostics, isNative } from "@/lib/capacitorBridge";

export function NativeDiagnostics() {
  const [expanded, setExpanded] = useState(true);
  const [data, setData] = useState<NativeDiagnosticsData | null>(null);
  const [location] = useLocation();
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isNative()) return;

    const refresh = async () => {
      const d = await getNativeDiagnostics();
      setData(d);
    };

    void refresh();
    intervalRef.current = window.setInterval(refresh, 2000);
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    };
  }, []);

  // Visa bara på native
  if (!isNative()) return null;

  const statusColor = (val: string) => {
    if (val === "granted") return "text-green-400";
    if (val === "denied") return "text-red-400";
    if (val.startsWith("fel:")) return "text-red-400";
    return "text-yellow-300";
  };

  return (
    <div
      className="fixed left-2 z-[9999] max-w-[95vw] rounded-xl bg-black/90 text-xs text-white shadow-2xl ring-1 ring-white/20 backdrop-blur-sm"
      style={{ fontFamily: "monospace", bottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      {/* Header / toggle */}
      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <span className="text-[10px]">🛠️</span>
        <span className="font-semibold text-[#FF8B01]">Native Diagnostics</span>
        <span className="ml-auto text-white/50">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="space-y-1 border-t border-white/10 px-3 pb-3 pt-2">
          {/* Platform */}
          <Row label="platform" value={data?.platform ?? "…"} />
          <Row label="isNative" value={String(data?.isNative ?? "…")} />

          {/* Route */}
          <Row label="route" value={location || "/"} />

          {/* Permissions */}
          <Row
            label="camera"
            value={data?.cameraPermission ?? "…"}
            className={statusColor(data?.cameraPermission ?? "")}
          />
          <Row
            label="location"
            value={data?.locationPermission ?? "…"}
            className={statusColor(data?.locationPermission ?? "")}
          />
          <Row
            label="camPreview"
            value={data ? String(data.cameraPreviewActive) : "…"}
            className={data?.cameraPreviewActive ? "text-green-400" : "text-yellow-300"}
          />

          {/* Errors */}
          {(data?.errors.length ?? 0) > 0 && (
            <div className="mt-1 space-y-0.5 rounded bg-red-900/40 p-1.5">
              <div className="text-[9px] uppercase tracking-widest text-red-400">Fel</div>
              {data!.errors.map((e, i) => (
                <div key={i} className="break-all text-[9px] leading-tight text-red-300">
                  {e}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  className = "text-white/90",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-white/40">{label}</span>
      <span className={`break-all ${className}`}>{value}</span>
    </div>
  );
}
