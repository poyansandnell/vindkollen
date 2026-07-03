import { useState } from "react";

/**
 * Varning + återhämtningsväg för in-app-webbläsare (Messenger, Instagram m.fl.)
 * som ofta blockerar kamera/GPS-behörighet helt. Återanvänds både på
 * startskärmen (PermissionGate) och i AR-vyns fel-/väntevy, så användaren
 * får samma vägledning oavsett var behörigheten faktiskt misslyckas.
 */
export function InAppBrowserNotice({ appName }: { appName: string }) {
  const [linkCopied, setLinkCopied] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2500);
    } catch {
      setLinkCopied(false);
    }
  };

  return (
    <div className="rounded-lg border border-yellow-400/30 bg-yellow-500/10 p-2.5 text-sm text-yellow-100">
      <p className="text-[13px] font-medium leading-snug text-yellow-50">⚠️ Öppnade i {appName}</p>
      <p className="mt-1 text-[12px] leading-snug text-yellow-100/80">
        Blockerar ofta kamera/GPS. Tryck <span className="font-medium">••• (eller ⋮)</span> och välj{" "}
        <span className="font-medium">"Öppna i webbläsare"</span>, eller kopiera länken:
      </p>
      <button
        onClick={handleCopyLink}
        className="mt-2 w-full rounded-full bg-yellow-400/20 py-1.5 text-xs font-semibold text-yellow-50 transition hover:bg-yellow-400/30"
      >
        {linkCopied ? "✓ Länk kopierad!" : "🔗 Kopiera länk"}
      </button>
    </div>
  );
}
