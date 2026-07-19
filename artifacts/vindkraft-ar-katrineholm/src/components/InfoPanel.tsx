import { KATRINEHOLM_PROJECT } from "@/lib/bundledProjects";
import { openPdf } from "@/lib/capacitorBridge";

export function InfoPanel({ onClose, projectId }: { onClose: () => void; projectId?: number | string }) {
  const showEricsberg =
    projectId != null && String(projectId) === String(KATRINEHOLM_PROJECT.id);

  return (
    <div className="absolute inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-[#111111] p-6 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-xl font-semibold text-white">Om Vindkollen</h2>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1 text-sm leading-relaxed text-white/75">
          <p>
            Vindkollen hjälper invånare att se och förstå hur planerade vindkraftsetableringar kan påverka
            landskapet, närboende och lokalsamhället.
          </p>
          <p>
            Genom Sverigekartan, lokala projektvyer och AR-visualisering kan användaren undersöka verkens
            placering, avstånd, riktning, ljudnivå och visuella påverkan direkt från den plats där man
            befinner sig.
          </p>
          <p>
            Målet är att göra information om planerade etableringar mer tillgänglig, tydlig och begriplig —
            så att fler kan bilda sig en egen uppfattning och delta i den lokala demokratiska processen.
          </p>
          <p>
            Vindkollen är utvecklad av{" "}
            <span className="font-medium text-[#FFB347]">@PoyanSandnell</span>. Den första versionen togs
            fram åt Katrineholm Framåt för att visa hur den planerade vindkraftsetableringen nära
            Katrineholms tätort kan påverka staden och dess invånare.
          </p>

          {showEricsberg && (
            <div className="mt-1 border-t border-white/10 pt-3">
              <h3 className="mb-2 text-sm font-semibold text-white">Ericsbergs planer — Katrineholms kommun</h3>
              <p>
                Denna projektvy har tagits fram åt Katrineholm Framåt för att tydliggöra hur den planerade
                etableringen norr om Katrineholm kan upplevas från olika delar av kommunen.
              </p>
              <p className="mt-2">
                Verktyget visar bland annat verkens riktning, avstånd, uppskattad ljudnivå och visuella
                påverkan. Syftet är att ge invånarna ett mer konkret underlag inför den fortsatta
                diskussionen om etableringen.
              </p>
              <button
                onClick={() => {
                  const base = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim() ?? "";
                  const url = base
                    ? `${base}/samradsyttrande-forsvarsmakten.pdf`
                    : `${window.location.origin}/samradsyttrande-forsvarsmakten.pdf`;
                  openPdf(url);
                }}
                className="mt-3 flex w-full items-center gap-2 rounded-xl border border-[#FF8B01]/30 bg-[#FF8B01]/10 px-3 py-2 text-left text-sm font-medium text-[#FFB347] hover:bg-[#FF8B01]/20"
              >
                📄 Försvarsmaktens samrådsyttrande (PDF)
              </button>
            </div>
          )}
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
