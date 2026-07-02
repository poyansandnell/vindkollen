interface PermissionGateProps {
  onStart: () => void;
  starting: boolean;
  errors: string[];
}

export function PermissionGate({ onStart, starting, errors }: PermissionGateProps) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-between bg-gradient-to-b from-[#0b1f1a] via-[#0e2a22] to-[#081713] px-6 py-10 text-emerald-50">
      <div className="mx-auto max-w-md text-center">
        <p className="text-xs font-semibold tracking-[0.2em] text-emerald-400">KATRINEHOLM</p>
        <h1 className="mt-3 text-3xl font-semibold leading-tight">Vindkraft AR Katrineholm</h1>
        <p className="mt-4 text-sm leading-relaxed text-emerald-200/70">
          Rikta kameran mot skogen norr om staden och se de 29 vindkraftverk som planeras vid Länsterberget — i verklig
          storlek, på rätt avstånd och i rätt riktning.
        </p>
      </div>

      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-emerald-200/80">
          <p className="mb-2 font-medium text-emerald-50">Appen behöver tillgång till:</p>
          <ul className="space-y-1.5">
            <li>📷 Kamera — för att visa verkligheten i bakgrunden</li>
            <li>📍 Plats (GPS) — för att räkna ut avstånd och riktning</li>
            <li>🧭 Kompass — för att veta vart du tittar</li>
          </ul>
        </div>

        {errors.length > 0 && (
          <div className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
            {errors.map((e, i) => (
              <p key={i}>{e}</p>
            ))}
          </div>
        )}

        <button
          onClick={onStart}
          disabled={starting}
          className="w-full rounded-full bg-emerald-500 py-4 text-base font-semibold text-emerald-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {starting ? "Startar…" : "Starta AR-vyn"}
        </button>
        <p className="text-center text-[11px] text-emerald-200/40">
          Fungerar bäst utomhus, i dagsljus eller kväll, med fri sikt mot horisonten.
        </p>
      </div>
    </div>
  );
}
