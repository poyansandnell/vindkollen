import { useState } from "react";

/**
 * Vägledning (INTE ett felmeddelande) för in-app-webbläsare (Messenger,
 * Instagram m.fl.) som ofta blockerar kamera/GPS-behörighet helt.
 * Återanvänds både på startskärmen (PermissionGate) och i AR-vyns
 * fel-/väntevy, så användaren får samma lugna, steg-för-steg-guide oavsett
 * var behörigheten faktiskt misslyckas.
 *
 * Juli 2026: designen bytt medvetet från en gul "⚠️ Öppnade i {appName}"-
 * varningsruta till en hjälpsam guide (svart bakgrund, orange huvudknapp,
 * inga varningssymboler) — se `.agents/memory/inapp-browser-permissions.md`.
 * `appName` tas emot men används inte längre i rubriken/brödtexten (som nu
 * är medvetet generisk, "Messenger, Facebook och vissa andra appar") — den
 * behålls i props-signaturen för bakåtkompatibilitet med anropsplatserna.
 */
export function InAppBrowserNotice({ appName: _appName }: { appName: string }) {
  const [linkCopied, setLinkCopied] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkCopied(true);
    } catch {
      setLinkCopied(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-[#090909] p-4 text-left text-white">
      <p className="text-base font-semibold leading-snug text-white">
        📱 Öppna i Safari för bästa AR-upplevelse
      </p>

      <p className="mt-2 text-[13px] leading-relaxed text-white/60">
        Vindkraft AR använder mobilens kamera, GPS och kompass.
      </p>
      <p className="mt-1 text-[13px] leading-relaxed text-white/60">
        Messenger, Facebook och vissa andra appar begränsar ibland dessa funktioner.
      </p>

      <p className="mt-3 text-[13px] font-medium text-white/80">För bästa upplevelse:</p>
      <ol className="mt-1.5 space-y-1 text-[13px] leading-relaxed text-white/60">
        <li>1. Kopiera länken</li>
        <li>2. Öppna Safari</li>
        <li>3. Klistra in länken och öppna sidan</li>
      </ol>

      <button
        onClick={handleCopyLink}
        className="mt-4 w-full rounded-full bg-[#FF8B01] py-3.5 text-sm font-semibold text-[#090909] shadow-lg shadow-[#FF8B01]/25 transition hover:bg-[#FFB347]"
      >
        {linkCopied ? "✅ Länken är kopierad" : "🔗 Kopiera länk"}
      </button>

      {linkCopied && (
        <p className="mt-2.5 text-center text-[12px] leading-relaxed text-white/50">
          Öppna nu Safari och håll fingret i adressfältet. Välj <span className="text-white/70">Klistra in</span> och
          öppna sidan.
        </p>
      )}

      <button
        onClick={() => setShowSteps((v) => !v)}
        className="mt-3 w-full rounded-full border border-white/15 bg-white/5 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10"
      >
        📖 Visa steg för steg
      </button>

      {showSteps && (
        <ol className="mt-2.5 space-y-1 rounded-xl bg-white/5 p-3 text-[12px] leading-relaxed text-white/60">
          <li>1. Tryck på Kopiera länk</li>
          <li>2. Öppna Safari</li>
          <li>3. Håll fingret i adressfältet</li>
          <li>4. Tryck Klistra in</li>
          <li>5. Öppna sidan</li>
        </ol>
      )}

      <div className="mt-4 border-t border-white/10 pt-3">
        <p className="text-[13px] font-medium text-white/80">⭐ Tips: Lägg till på hemskärmen</p>
        <p className="mt-1.5 text-[12px] leading-relaxed text-white/50">
          När sidan är öppnad i Safari kan du spara Vindkraft AR på hemskärmen. Då öppnas den som en app nästa gång.
        </p>
        <ol className="mt-2 space-y-1 text-[12px] leading-relaxed text-white/50">
          <li>1. Tryck på Dela-knappen i Safari</li>
          <li>2. Välj Lägg till på hemskärmen</li>
          <li>3. Tryck Lägg till</li>
        </ol>
      </div>
    </div>
  );
}
