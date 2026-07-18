import { useLocation } from "wouter";

export default function About() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen bg-[#090909] text-white pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <button onClick={() => navigate("/")} className="mb-6 text-sm text-white/50 hover:text-white">
          ← Tillbaka
        </button>
        <h1 className="mb-4 text-2xl font-bold">Om appen</h1>
        <div className="prose prose-invert prose-sm max-w-none space-y-4 text-white/80">
          <p>
            Den här appen låter dig se hur vindkraftverk ser ut i verkligheten — direkt i
            kamerabilden från din telefon. Du kan placera ut verk på valfri plats i Sverige,
            beräkna miljöpåverkan och dela dina placeringar.
          </p>
          <h2 className="mt-6 text-base font-semibold text-white">Datakällor</h2>
          <ul className="list-disc space-y-1 pl-4 text-sm">
            <li>Vindbrukskollen (Energimyndigheten) — nationellt vindkraftsregister</li>
            <li>Lantmäteriet / OpenStreetMap — orter och skyddade områden</li>
            <li>SMHI — meteorologiska vindriktningar</li>
          </ul>
          <h2 className="mt-6 text-base font-semibold text-white">Teknik</h2>
          <p className="text-sm">
            AR-läget använder GPS, kompass och kamera för att placera 3D-modeller i rätt riktning
            och avstånd. Kartverktyget använder satellitbilder från Esri World Imagery. Ingen data
            skickas till tredje part utan ditt godkännande.
          </p>
          <h2 className="mt-6 text-base font-semibold text-white">Version</h2>
          <p className="text-sm text-white/50">Beta · 2025</p>
        </div>
      </div>
    </div>
  );
}
