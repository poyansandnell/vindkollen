import { useLocation } from "wouter";

export default function Contact() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-screen bg-[#090909] text-white">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <button onClick={() => navigate("/")} className="mb-6 text-sm text-white/50 hover:text-white">
          ← Tillbaka
        </button>
        <h1 className="mb-4 text-2xl font-bold">Kontakt</h1>
        <div className="space-y-4 text-white/80">
          <p className="text-sm">
            Har du frågor, hittat ett fel, eller vill begära radering av ditt konto?
            Kontakta oss via formuläret nedan.
          </p>

          <div className="rounded-xl border border-white/10 bg-white/5 p-6">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const email = (form.elements.namedItem("email") as HTMLInputElement).value;
                const message = (form.elements.namedItem("message") as HTMLTextAreaElement).value;
                window.location.href = `mailto:hej@vindkraftapp.se?subject=Kontakt&body=${encodeURIComponent(message)}&from=${encodeURIComponent(email)}`;
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-white/60" htmlFor="email">
                  Din e-post
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
                  placeholder="Skriv ditt meddelande här…"
                />
              </div>
              <button
                type="submit"
                className="w-full rounded-full bg-[#FF8B01] py-2.5 text-sm font-semibold text-[#090909]"
              >
                Skicka
              </button>
            </form>
          </div>

          <p className="text-xs text-white/40">
            Vi strävar efter att svara inom 3 arbetsdagar.
          </p>

          <div className="mt-6 space-y-1 text-xs text-white/40">
            <p>
              <a href="/integritetspolicy" className="underline hover:text-white/70">
                Integritetspolicy
              </a>{" "}
              ·{" "}
              <a href="/villkor" className="underline hover:text-white/70">
                Användarvillkor
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
