import { useLocation } from "wouter";

export default function Terms() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen bg-[#090909] text-white pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <button onClick={() => navigate("/")} className="mb-6 text-sm text-white/50 hover:text-white">
          ← Tillbaka
        </button>
        <h1 className="mb-4 text-2xl font-bold">Användarvillkor</h1>
        <div className="prose prose-invert prose-sm max-w-none space-y-4 text-white/80">
          <p className="text-xs text-white/40">Senast uppdaterad: januari 2025</p>

          <h2 className="mt-6 text-base font-semibold text-white">Användning</h2>
          <p className="text-sm">
            Appen är kostnadsfri för privatpersoner. Du får inte använda appen för kommersiellt
            syfte utan skriftligt tillstånd.
          </p>

          <h2 className="mt-6 text-base font-semibold text-white">Ansvarsfriskrivning</h2>
          <p className="text-sm">
            AR-visualiseringarna och påverkansberäkningarna är estimat baserade på öppna datakällor.
            De utgör inte tekniska underlag för tillståndsärenden eller officiella utlåtanden.
            Verkens exakta placering, höjd och ljud kan avvika från verkligheten.
          </p>

          <h2 className="mt-6 text-base font-semibold text-white">Delat innehåll</h2>
          <p className="text-sm">
            Placeringar du delar med delningslänk är läsbara för alla som har länken. Du ansvarar
            för innehållet i dina placeringar.
          </p>

          <h2 className="mt-6 text-base font-semibold text-white">Ändringar</h2>
          <p className="text-sm">
            Vi kan uppdatera dessa villkor. Fortsatt användning efter ändringar innebär att du
            accepterar de nya villkoren.
          </p>
        </div>
      </div>
    </div>
  );
}
