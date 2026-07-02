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
        {/*
          Logotyp för Katrineholm FRAMÅT (transparent SVG). Om en ny logotypfil finns, lägg den i
          public/logo.svg (ersätter den nuvarande) — <img> nedan används automatiskt då.
          Faller tillbaka till textbaserad logotyp om bilden saknas.
        */}
        <div className="mx-auto flex flex-col items-center justify-center" role="img" aria-label="Katrineholm FRAMÅT">
          <img
            src="/logo.svg"
            alt="Katrineholm FRAMÅT"
            className="h-20 w-auto object-contain"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
              if (fallback) fallback.style.display = "block";
            }}
          />
          <span className="hidden text-center leading-tight tracking-wide">
            <span className="block text-2xl font-semibold text-white">Katrineholm</span>
            <span className="block text-4xl font-black uppercase text-[#FF8B01]">FRAMÅT</span>
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
        <p className="text-center text-[11px] leading-relaxed text-white/40">
          Se begärd kopia från Ericsbergs Säteri/Renewable Sweden AB:s begäran om samrådsyttrande till
          Försvarsmakten. Underlaget avser Ericsbergs Vind 1–5 i Katrineholms kommun och omfattar totalt 29
          vindkraftverk med maximal totalhöjd 250 meter.
        </p>
        <a
          href="/samradsyttrande-forsvarsmakten.pdf"
          target="_blank"
          rel="noopener noreferrer"
          download="Ericsbergs-samradsyttrande-forsvarsmakten.pdf"
          className="mx-auto flex w-fit items-center gap-1.5 rounded-full border border-[#FF8B01]/40 bg-[#FF8B01]/10 px-4 py-2 text-[11px] font-medium text-[#FFB347] transition hover:bg-[#FF8B01]/20"
        >
          📄 Visa/ladda ner underlaget (PDF)
        </a>
        <p className="text-center text-[10px] text-white/25">
          Visualiseringen bygger på koordinater och uppgifter från det bifogade underlaget.
        </p>
        <p className="text-center text-[11px] text-white/30">
          Fungerar bäst utomhus, i dagsljus eller kväll, med fri sikt mot horisonten.
        </p>
      </div>
    </div>
  );
}
