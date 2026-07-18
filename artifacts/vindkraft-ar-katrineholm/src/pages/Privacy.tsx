import { useLocation } from "wouter";

export default function Privacy() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen bg-[#090909] text-white pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <button onClick={() => navigate("/")} className="mb-6 text-sm text-white/50 hover:text-white">
          ← Tillbaka
        </button>
        <h1 className="mb-4 text-2xl font-bold">Integritetspolicy</h1>
        <div className="prose prose-invert prose-sm max-w-none space-y-4 text-white/80">
          <p className="text-xs text-white/40">Senast uppdaterad: januari 2025</p>

          <h2 className="mt-6 text-base font-semibold text-white">Vilka uppgifter samlar vi in?</h2>
          <p className="text-sm">
            Om du loggar in sparas e-post, namn och profilbild från din inloggningsleverantör. Dina
            sparade placeringar (GPS-koordinater, turbinpositioner) sparas i vår databas kopplat
            till ditt konto.
          </p>
          <p className="text-sm">
            Om du inte loggar in sparas dina placeringar <em>enbart lokalt</em> i webbläsarens
            localStorage och lämnar aldrig din enhet.
          </p>

          <h2 className="mt-6 text-base font-semibold text-white">Cookies och sessions</h2>
          <p className="text-sm">
            Vi använder en krypterad sessions-cookie (<code>sid</code>) för att hålla dig inloggad
            i 7 dagar. Inga reklam- eller spårningscookies används.
          </p>

          <h2 className="mt-6 text-base font-semibold text-white">Platsdata</h2>
          <p className="text-sm">
            GPS-positionen används <em>enbart lokalt</em> på din enhet för AR-vyn. Din
            realtidsposition skickas aldrig till servern utan ditt uttryckliga medgivande.
          </p>

          <h2 className="mt-6 text-base font-semibold text-white">Radering av konto</h2>
          <p className="text-sm">
            Du kan begära radering av ditt konto och all kopplad data via vår{" "}
            <a href="/kontakt" className="underline">
              kontaktsida
            </a>
            . Vi genomför raderingen inom 30 dagar.
          </p>

          <h2 className="mt-6 text-base font-semibold text-white">Kontakt</h2>
          <p className="text-sm">
            Frågor om integritet skickas till kontaktsidan nedan.
          </p>
        </div>
      </div>
    </div>
  );
}
