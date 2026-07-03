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
    <div className="rounded-xl border border-yellow-400/30 bg-yellow-500/10 p-3.5 text-sm text-yellow-100">
      <p className="font-medium text-yellow-50">⚠️ Du öppnade länken i {appName}</p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-yellow-100/80">
        {appName}s inbyggda webbläsare blockerar ofta kamera och GPS, så appen kanske inte kan fråga om
        behörighet alls. Öppna länken i Safari eller Chrome istället — tryck på{" "}
        <span className="font-medium">••• (eller ⋮)</span> uppe i hörnet och välj{" "}
        <span className="font-medium">"Öppna i webbläsare"</span>, eller kopiera länken nedan och klistra in
        den i Safari/Chrome.
      </p>
      <button
        onClick={handleCopyLink}
        className="mt-2.5 w-full rounded-full bg-yellow-400/20 py-2 text-xs font-semibold text-yellow-50 transition hover:bg-yellow-400/30"
      >
        {linkCopied ? "✓ Länk kopierad!" : "🔗 Kopiera länk"}
      </button>
    </div>
  );
}
