import { useLocation } from "wouter";

export default function DeleteAccount() {
  const [, navigate] = useLocation();
  return (
    <div
      className="min-h-screen bg-[#090909] text-white pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto max-w-2xl px-4 py-8">
        <button onClick={() => navigate("/")} className="mb-6 text-sm text-white/50 hover:text-white">
          ← Tillbaka
        </button>
        <h1 className="mb-2 text-2xl font-bold">Radera konto och data</h1>
        <p className="mb-6 text-xs text-white/40">Senast uppdaterad: juli 2026</p>

        <div className="space-y-6 text-sm text-white/80">

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Hur du raderar din data</h2>
            <p>
              Vindkollen lagrar all din data <strong className="text-white">lokalt på din enhet</strong> —
              inga personuppgifter skickas till eller lagras på någon server. Du kan därför
              radera all data direkt på enheten, utan att kontakta oss.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Radera direkt i appen</h2>
            <ol className="space-y-2 list-none">
              <li className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="font-medium text-white">📱 iOS (iPhone/iPad)</p>
                <p className="mt-1 text-white/70">
                  Inställningar → Allmänt → iPhone-lagring → Vindkollen → Radera app.
                  All lokal data tas bort tillsammans med appen.
                </p>
              </li>
              <li className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="font-medium text-white">🤖 Android</p>
                <p className="mt-1 text-white/70">
                  Inställningar → Appar → Vindkollen → Lagring → Rensa data,
                  eller avinstallera appen för att ta bort allt.
                </p>
              </li>
              <li className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="font-medium text-white">🌐 Webb (vindkollen.se)</p>
                <p className="mt-1 text-white/70">
                  Öppna webbläsarinställningarna → Webbplatsdata → vindkollen.se → Rensa.
                  Alternativt: rensa webbläsarens cache och lokala lagring helt.
                </p>
              </li>
            </ol>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Vilken data raderas</h2>
            <ul className="mt-2 space-y-1">
              {[
                "Sparade turbinplaceringar och jämförelsepunkter",
                "Projektinställningar och egna anteckningar",
                "Appinställningar och preferenser",
                "All övrig data lagrad lokalt på enheten",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-0.5 text-[#FF8B01]">✓</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Kontakta oss för hjälp</h2>
            <p>
              Om du behöver hjälp med att radera data, eller har frågor om vad som lagras,
              är du välkommen att höra av dig:
            </p>
            <a
              href="mailto:support@vindkollen.com"
              className="mt-3 flex items-center gap-2 rounded-lg border border-[#FF8B01]/30 bg-[#FF8B01]/10 px-4 py-3 text-[#FF8B01] hover:bg-[#FF8B01]/20 transition-colors"
            >
              <span className="text-lg">✉</span>
              <span className="font-medium">support@vindkollen.com</span>
            </a>
            <p className="mt-3 text-white/50 text-xs">
              Vi svarar normalt inom 1–3 arbetsdagar. Vi bekräftar skriftligen när radering är genomförd.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Lagstadgad lagring</h2>
            <p>
              Eftersom Vindkollen inte samlar in eller lagrar personuppgifter på server
              finns det ingen data att radera från vår sida. Eventuell kommunikation via
              e-post till support kan sparas i upp till 12 månader enligt bokförings- och
              supportrutiner, i enlighet med gällande lagstiftning.
            </p>
          </section>

        </div>

        <div className="mt-10 border-t border-white/10 pt-6 flex gap-4 text-xs text-white/40">
          <button onClick={() => navigate("/integritetspolicy")} className="underline hover:text-white/70">
            Integritetspolicy
          </button>
          <button onClick={() => navigate("/villkor")} className="underline hover:text-white/70">
            Användarvillkor
          </button>
          <button onClick={() => navigate("/kontakt")} className="underline hover:text-white/70">
            Kontakt
          </button>
        </div>
      </div>
    </div>
  );
}
