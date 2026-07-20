import { useLocation } from "wouter";

export default function About() {
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
        <h1 className="mb-6 text-2xl font-bold">Om Vindkollen AR</h1>

        <div className="space-y-6 text-sm text-white/80">

          <section>
            <p className="leading-relaxed">
              Vindkollen AR låter dig rikta kameran mot horisonten och se, i augmented reality,
              hur planerade och befintliga vindkraftverk ser ut i landskapet — på rätt avstånd
              och i rätt riktning baserat på din GPS-position och kompass.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Funktioner</h2>
            <ul className="space-y-1.5 pl-4 list-disc">
              <li>AR-vy med 3D-vindkraftverk på exakt geografisk position</li>
              <li>Beräknad ljudnivå (dBA) och skuggflimmer</li>
              <li>Kartverktyg — placera verk fritt och jämför placeringar</li>
              <li>Sverigekartan — utforska alla planerade projekt</li>
              <li>Fotomontage — spara en stillbild från AR-vyn</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Datakällor</h2>
            <ul className="space-y-1.5 pl-4 list-disc">
              <li>Vindbrukskollen (Energimyndigheten) — nationellt vindkraftsregister</li>
              <li>Esri World Imagery — satellitbilder i kartverktyget</li>
              <li>SMHI — meteorologiska vindriktningar</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Teknik &amp; integritet</h2>
            <p className="leading-relaxed">
              AR-läget använder GPS, kompass och kamera lokalt på din enhet — ingen data
              skickas till servrar. Dina sparade placeringar lagras enbart i appens lokala
              minne (localStorage) och lämnar aldrig din telefon.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-base font-semibold text-white">Support</h2>
            <p>
              Frågor eller problem? Kontakta oss på{" "}
              <a
                href="mailto:support@vindkollen.com"
                className="text-[#FF8B01] underline hover:text-[#FFB347]"
              >
                support@vindkollen.com
              </a>
              {" "}eller via{" "}
              <button
                onClick={() => navigate("/kontakt")}
                className="text-[#FF8B01] underline hover:text-[#FFB347]"
              >
                supportsidan
              </button>
              .
            </p>
          </section>

          <p className="text-xs text-white/40">Version 1.0 · 2026</p>

        </div>

        <div className="mt-10 border-t border-white/10 pt-6 flex flex-wrap gap-4 text-xs text-white/40">
          <button onClick={() => navigate("/integritetspolicy")} className="underline hover:text-white/70">
            Integritetspolicy
          </button>
          <button onClick={() => navigate("/villkor")} className="underline hover:text-white/70">
            Användarvillkor
          </button>
          <button onClick={() => navigate("/kontakt")} className="underline hover:text-white/70">
            Support &amp; Kontakt
          </button>
        </div>
      </div>
    </div>
  );
}
