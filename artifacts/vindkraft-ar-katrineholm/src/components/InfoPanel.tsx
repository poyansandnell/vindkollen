export function InfoPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-[#111111] p-6 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-semibold text-white">Bakgrund om planerna</h2>
          <button onClick={onClose} className="shrink-0 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20">
            ✕
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-sm leading-relaxed text-white/75">
          <p>
            Detta är de vindkraftverk som Ericsbergs Säteri genom Renewable Sweden AB har begärt
            samrådsyttrande om hos Försvarsmakten.
          </p>
          <p>
            Underlaget avser Ericsbergs Vind 1–5 i Katrineholms kommun, totalt 29 vindkraftverk fördelade på
            fem delområden.
          </p>
          <p>
            Om dessa verk byggs finns en risk att det öppnar för betydligt större vindkraftsparker i
            Katrineholms kommun.
          </p>
          <p>
            Som jämförelse presenterade Holmen tidigare planer på upp till 77 vindkraftverk i området kring
            Simonstorp i Norrköpings och Finspångs kommuner. Projektet omarbetades senare till 32 verk.
            Norrköpings kommun valde därefter att använda sitt kommunala veto mot den del av etableringen som
            berörde kommunen.
          </p>
        </div>

        <button
          onClick={onClose}
          className="mt-5 w-full rounded-full bg-[#FF8B01] py-3 text-sm font-semibold text-[#090909] hover:bg-[#FFB347]"
        >
          Stäng
        </button>
      </div>
    </div>
  );
}
