interface PermissionGateProps {
  onStart: () => void;
  starting: boolean;
  errors: string[];
  turbineCount: number;
}

export function PermissionGate({ onStart, starting, errors, turbineCount }: PermissionGateProps) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-between overflow-y-auto bg-[#090909] px-6 py-10 text-white">
      <div className="mx-auto w-full max-w-md text-center">
        {/* Platshållare för Katrineholm FRAMÅTs logotyp — byt ut mot riktig logotyp senare. */}
        <div
          className="mx-auto flex h-24 w-24 items-center justify-center rounded-2xl border-2 border-dashed border-[#FF8B01]/70 bg-[#FF8B01]/5"
          role="img"
          aria-label="Katrineholm FRAMÅT-logotyp (platshållare)"
        >
          <span className="px-2 text-center text-[11px] font-semibold leading-tight tracking-wide text-[#FFB347]">
            KATRINEHOLM
            <br />
            FRAMÅT
          </span>
        </div>

        <h1 className="mt-6 text-3xl font-bold leading-tight text-white">Vindkraft AR</h1>

        <p className="mt-4 text-sm leading-relaxed text-white/70">
          Visualisera hur de planerade vindkraftverken kan komma att upplevas från olika platser i Katrineholm.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-white/50">
          Appen använder kameran, GPS och mobilens kompass för att placera vindkraftverken i rätt riktning och
          på ungefär rätt avstånd.
        </p>
      </div>

      <div className="mx-auto mt-8 w-full max-w-md space-y-4">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
          <p className="mb-2 font-medium text-white">Appen behöver tillgång till:</p>
          <ul className="space-y-1.5">
            <li>📷 Kamera — för att visa verkligheten i bakgrunden</li>
            <li>📍 Plats (GPS) — för att räkna ut avstånd och riktning</li>
            <li>🧭 Kompass — för att veta vart du tittar</li>
          </ul>
          <p className="mt-2 text-xs text-white/40">{turbineCount} planerade vindkraftverk visas i vyn.</p>
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
          className="w-full rounded-full bg-[#FF8B01] py-4 text-base font-semibold text-[#090909] shadow-lg shadow-[#FF8B01]/20 transition hover:bg-[#FFB347] disabled:opacity-60"
        >
          {starting ? "Startar…" : "Starta visualisering"}
        </button>
        <p className="text-center text-[11px] text-white/30">
          Fungerar bäst utomhus, i dagsljus eller kväll, med fri sikt mot horisonten.
        </p>
      </div>
    </div>
  );
}
