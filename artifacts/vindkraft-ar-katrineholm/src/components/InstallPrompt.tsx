import { Download, Share, SquarePlus, X } from "lucide-react";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";

export default function InstallPrompt() {
  const { shouldShow, isIos, canPromptAndroid, promptInstall, dismiss } = useInstallPrompt();

  if (!shouldShow) return null;

  return (
    <div
      className="absolute bottom-3 right-3 z-20 max-w-xs rounded-md border bg-black/80 p-3 shadow-md backdrop-blur-sm flex flex-col gap-2"
      data-testid="panel-install-prompt"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-white">Installera appen</p>
        <button
          onClick={dismiss}
          className="shrink-0 text-white/60 hover:text-white"
          aria-label="Stäng"
          data-testid="button-dismiss-install-prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {canPromptAndroid ? (
        <>
          <p className="text-xs text-white/70">
            Lägg till Vindkollen på hemskärmen för snabb åtkomst.
          </p>
          <button
            className="self-start rounded-full bg-[#FF8B01] px-3 py-1.5 text-xs font-semibold text-[#090909] shadow shadow-[#FF8B01]/30 transition hover:bg-[#FFB347] flex items-center gap-1"
            onClick={promptInstall}
            data-testid="button-install-app"
          >
            <Download className="h-3.5 w-3.5" />
            Installera
          </button>
        </>
      ) : (
        <p className="text-xs text-white/70 flex flex-wrap items-center gap-1">
          Lägg till på hemskärmen: tryck på
          <Share className="h-3.5 w-3.5 inline shrink-0" />
          och välj
          <span className="inline-flex items-center gap-0.5 font-medium text-white">
            <SquarePlus className="h-3.5 w-3.5 shrink-0" />
            Lägg till på hemskärmen
          </span>
          .
        </p>
      )}
    </div>
  );
}
