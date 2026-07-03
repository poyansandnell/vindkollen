import { Download, Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";

export default function InstallPrompt() {
  const { shouldShow, isIos, canPromptAndroid, promptInstall, dismiss } = useInstallPrompt();

  if (!shouldShow) return null;

  return (
    <div
      className="absolute bottom-3 right-3 z-20 max-w-xs bg-background/95 rounded-md shadow-md border p-3 flex flex-col gap-2"
      data-testid="panel-install-prompt"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">Installera appen</p>
        <button
          onClick={dismiss}
          className="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="Stäng"
          data-testid="button-dismiss-install-prompt"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {canPromptAndroid ? (
        <>
          <p className="text-xs text-muted-foreground">
            Lägg till Vindkraft Karta på hemskärmen för snabb åtkomst.
          </p>
          <Button
            size="sm"
            className="self-start"
            onClick={promptInstall}
            data-testid="button-install-app"
          >
            <Download className="h-4 w-4 mr-1" />
            Installera
          </Button>
        </>
      ) : (
        <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-1">
          Lägg till på hemskärmen: tryck på
          <Share className="h-3.5 w-3.5 inline shrink-0" />
          och välj
          <span className="inline-flex items-center gap-0.5 font-medium">
            <SquarePlus className="h-3.5 w-3.5 shrink-0" />
            Lägg till på hemskärmen
          </span>
          .
        </p>
      )}
    </div>
  );
}
