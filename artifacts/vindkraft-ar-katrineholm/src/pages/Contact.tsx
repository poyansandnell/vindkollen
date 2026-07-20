import { useLocation } from "wouter";

const SUPPORT_EMAIL = "support@vindkollen.com";

export default function Contact() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen bg-[#090909] text-white pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <button onClick={() => navigate("/")} className="mb-6 text-sm text-white/50 hover:text-white">
          ← Tillbaka
        </button>
        <h1 className="mb-2 text-2xl font-bold">Support &amp; Kontakt</h1>
        <p className="mb-6 text-sm text-white/60">
          Har du frågor, hittat ett fel eller vill rapportera något?
        </p>

        <div className="space-y-4">

          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="flex items-center gap-3 rounded-xl border border-[#FF8B01]/30 bg-[#FF8B01]/10 px-5 py-4 text-sm font-semibold text-[#FFB347] hover:bg-[#FF8B01]/20"
          >
            <span className="text-lg">✉️</span>
            <span>{SUPPORT_EMAIL}</span>
          </a>

          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <h2 className="mb-4 text-sm font-semibold text-white">Skicka ett meddelande</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const email = (form.elements.namedItem("email") as HTMLInputElement).value;
                const subject = (form.elements.namedItem("subject") as HTMLSelectElement).value;
                const message = (form.elements.namedItem("message") as HTMLTextAreaElement).value;
                window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message + "\n\nSvar till: " + email)}`;
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="subject">
                  Ämne
                </label>
                <select
                  id="subject"
                  name="subject"
                  className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white focus:border-[#FF8B01] focus:outline-none"
                >
                  <option value="Fråga om appen">Fråga om appen</option>
                  <option value="Tekniskt fel">Tekniskt fel / bugg</option>
                  <option value="Radering av data">Radering av lokal data</option>
                  <option value="Annat">Annat</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="email">
                  Din e-post (för svar)
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#FF8B01] focus:outline-none"
                  placeholder="din@email.se"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="message">
                  Meddelande
                </label>
                <textarea
                  id="message"
                  name="message"
                  required
                  rows={5}
                  className="w-full rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#FF8B01] focus:outline-none"
                  placeholder="Beskriv ditt ärende…"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-full bg-[#FF8B01] py-2.5 text-sm font-semibold text-[#090909] hover:bg-[#FFB347]"
              >
                Öppna i e-postklient
              </button>
            </form>
          </div>

          <p className="text-xs text-white/40">
            Vi strävar efter att svara inom 3 arbetsdagar.
          </p>

          <div className="mt-4 flex gap-4 text-xs text-white/40">
            <button onClick={() => navigate("/integritetspolicy")} className="underline hover:text-white/70">
              Integritetspolicy
            </button>
            <button onClick={() => navigate("/villkor")} className="underline hover:text-white/70">
              Användarvillkor
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
