import { useLocation } from "wouter";

export default function Privacy() {
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
        <h1 className="mb-2 text-2xl font-bold">Integritetspolicy</h1>
        <p className="mb-6 text-xs text-white/40">Senast uppdaterad: juli 2026</p>

        <div className="space-y-6 text-sm text-white/80">

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Sammanfattning</h2>
            <p>
              Vindkollen AR samlar <strong className="text-white">inte in personuppgifter</strong> och
              skickar ingen data till externa servrar. Appen använder kamera, GPS och kompass
              enbart lokalt på din enhet för att visa vindkraftverken i AR-läget.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Vilka behörigheter används och varför?</h2>
            <ul className="space-y-3">
              <li className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="font-medium text-white">📍 Plats (GPS)</p>
                <p className="mt-1 text-white/70">
                  Används för att beräkna din position relativt vindkraftverken och visa rätt
                  avstånd och riktning i AR-vyn. Din GPS-position bearbetas enbart lokalt och
                  skickas aldrig till någon server.
                </p>
              </li>
              <li className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="font-medium text-white">📷 Kamera</p>
                <p className="mt-1 text-white/70">
                  Används som bakgrund i AR-läget så att 3D-modellerna av vindkraftverken kan
                  läggas ovanpå kamerabilden. Kameraströmmen bearbetas enbart lokalt — inga bilder
                  sparas eller skickas någonstans om du inte själv tar ett fotomontage och delar det.
                </p>
              </li>
              <li className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="font-medium text-white">🧭 Kompass och rörelsesensorer</p>
                <p className="mt-1 text-white/70">
                  Används för att beräkna i vilken riktning du håller telefonen så att
                  vindkraftverken visas på rätt ställe i kamerabilden. Sensordata bearbetas
                  enbart lokalt och lagras inte.
                </p>
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Vilken data sparas?</h2>
            <p>
              Dina placeringar (turbinpositioner, jämförelser) sparas{" "}
              <strong className="text-white">enbart lokalt</strong> i webbläsarens/appens
              localStorage på din enhet. Inga uppgifter om dig eller din enhet skickas till
              någon server, och ingen tredje part har tillgång till dem.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Tredjeparter</h2>
            <p>
              Kartvyn hämtar satellitbilder direkt från Esri World Imagery och
              Vindbrukskollen-data från Energimyndighetens öppna API. Dessa förfrågningar
              innehåller inte din GPS-position eller personuppgifter — enbart kartans
              geografiska utsnitt.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Radering av data</h2>
            <p>
              Eftersom all data lagras lokalt på din enhet kan du när som helst rensa den via
              telefonens inställningar (rensa appdata/webbläsarens cache). Du kan också kontakta
              oss om du har frågor om datahantering.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Barn</h2>
            <p>
              Appen riktar sig inte till barn under 13 år och samlar inte in uppgifter om barn.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-base font-semibold text-white">Kontakt</h2>
            <p>
              Frågor om integritet skickas till{" "}
              <a
                href="mailto:support@vindkollen.com"
                className="text-[#FF8B01] underline hover:text-[#FFB347]"
              >
                support@vindkollen.com
              </a>
              {" "}eller via vår{" "}
              <button
                onClick={() => navigate("/kontakt")}
                className="text-[#FF8B01] underline hover:text-[#FFB347]"
              >
                kontaktsida
              </button>
              .
            </p>
          </section>

        </div>

        <div className="mt-10 border-t border-white/10 pt-6 flex gap-4 text-xs text-white/40">
          <button onClick={() => navigate("/villkor")} className="underline hover:text-white/70">
            Användarvillkor
          </button>
          <button onClick={() => navigate("/kontakt")} className="underline hover:text-white/70">
            Kontakt
          </button>
          <button onClick={() => navigate("/om")} className="underline hover:text-white/70">
            Om appen
          </button>
        </div>
      </div>
    </div>
  );
}
