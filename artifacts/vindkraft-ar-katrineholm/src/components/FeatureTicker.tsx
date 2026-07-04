// Kort funktionslista som rullar horisontellt över skärmen medan appen
// startar (GPS/kompass/AR-uppsättning), så väntetiden — särskilt
// kompass-kalibreringen, som inte har en fast längd — känns aktiv och
// informativ istället för overksam. Listan dubbleras och animeras exakt
// -50% (se `feature-ticker-scroll` i `index.css`) för en sömlös loop.
const FEATURES = [
  "📱 AR-visualisering direkt i mobilkameran",
  "📍 Visar samtliga 29 planerade vindkraftverk",
  "🧭 GPS och kompass placerar verken i rätt riktning",
  "📏 Verklig storlek och avstånd",
  "🌍 SWEREF99 TM → WGS84 automatiskt",
  "⚙️ Snurrande rotorblad, olika hastigheter",
  "🔴 Blinkande hinderljus",
  "🌙 Dag- och nattläge",
  "☀️ Virtuell sol, aktuell solposition",
  "🌅 Lågsolsläge med långa skuggor",
  "🌗 Skuggflimmer (bladskuggor)",
  "🎧 Realistiskt vind- och turbinljud",
  "📈 Beräknad ljudnivå (dBA) där du står",
  "🛰️ Satellitkarta med placeringar",
  "📸 Fotomontage att spara och dela",
  "📄 Namninsamling för folkomröstning",
  "📲 Installationsbar som PWA",
];

export function FeatureTicker() {
  const items = [...FEATURES, ...FEATURES];

  return (
    <div className="mt-8 w-full overflow-hidden border-t border-white/10 py-3">
      <div
        className="flex w-max gap-8"
        style={{ animation: "feature-ticker-scroll 32s linear infinite" }}
      >
        {items.map((item, i) => (
          <span key={i} className="whitespace-nowrap text-[11px] text-white/45">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}
