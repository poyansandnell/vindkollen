import { usePwaUpdate } from "@/lib/pwaUpdate";

/**
 * Icke-blockerande banner som visas när en ny version av appen finns
 * nedladdad och redo. Uppdateringen appliceras ALDRIG automatiskt (det
 * skulle kunna avbryta en pågående AR-session med GPS/kamera igång) — bara
 * när användaren själv trycker på knappen.
 */
export function PwaUpdateBanner() {
  const { needRefresh, applyUpdate } = usePwaUpdate();

  if (!needRefresh) return null;

  return (
    <div className="pointer-events-auto fixed inset-x-0 bottom-0 z-50 flex items-center justify-between gap-3 bg-[#FF8B01] px-4 py-3 text-sm font-medium text-[#090909] shadow-lg">
      <span>En ny version av appen är redo.</span>
      <button
        onClick={applyUpdate}
        className="shrink-0 rounded-full bg-[#090909] px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-black"
      >
        Uppdatera nu
      </button>
    </div>
  );
}
