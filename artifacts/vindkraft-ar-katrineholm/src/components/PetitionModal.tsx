import { useEffect, useState } from "react";

const STORAGE_KEY = "vindkraft-ar-katrineholm:signatures";
const CONTACT_EMAIL = "info@katrineholmframat.se";

interface Signature {
  name: string;
  phone: string;
  email: string;
  ort: string;
  timestamp: number;
}

function loadSignatures(): Signature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Signature[]) : [];
  } catch {
    return [];
  }
}

function buildMailto(entry: Signature): string {
  const subject = "Intresseanmälan – Folkomröstning om vindkraft 2026";
  const body = [
    `För- och efternamn: ${entry.name}`,
    `Telefonnummer: ${entry.phone}`,
    `E-post: ${entry.email || "-"}`,
    `Ort: ${entry.ort || "-"}`,
    "",
    `Skickat: ${new Date(entry.timestamp).toLocaleString("sv-SE")}`,
  ].join("\n");
  return `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function PetitionModal({ onClose }: { onClose: () => void }) {
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [ort, setOrt] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSignatures(loadSignatures());
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Ange för- och efternamn.");
      return;
    }
    if (phone.trim().length < 4) {
      setError("Ange ditt telefonnummer.");
      return;
    }

    const entry: Signature = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      ort: ort.trim(),
      timestamp: Date.now(),
    };

    // Spara lokalt som backup (localStorage) — ingen backend i den här appen.
    const next = [...signatures, entry];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSignatures(next);

    // Skicka intresseanmälan via mailto — öppnar användarens e-postklient
    // med alla uppgifter ifyllda i meddelandet.
    window.location.href = buildMailto(entry);

    setSubmitted(true);
    setError(null);
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center overflow-y-auto bg-black/70 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-[#111111] p-6 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Folkomröstning om vindkraft 2026</h2>
            <p className="mt-3 text-sm text-white/70">
              En giltig namninsamling för en kommunal folkomröstning kräver underskrifter på papper. Skicka in
              din intresseanmälan så kontaktar Katrineholm FRAMÅT dig med information om hur och var du kan
              skriva under.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20">
            ✕
          </button>
        </div>

        {submitted ? (
          <div className="rounded-2xl bg-[#FF8B01]/10 p-5 text-center">
            <p className="text-lg font-medium text-white">
              Tack! Katrineholm FRAMÅT kommer att kontakta dig med information om hur du kan skriva under
              namninsamlingen på papper.
            </p>
            <p className="mt-1 text-sm text-white/60">
              {signatures.length} {signatures.length === 1 ? "person har" : "personer har"} anmält intresse hittills
              på den här enheten.
            </p>
            <button
              onClick={onClose}
              className="mt-4 rounded-full bg-[#FF8B01] px-6 py-2 text-sm font-semibold text-[#090909] hover:bg-[#FFB347]"
            >
              Stäng
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">För- och efternamn *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="För- och efternamn"
                required
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder:text-white/30 focus:border-[#FF8B01] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Telefonnummer *</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                inputMode="tel"
                placeholder="T.ex. 070-123 45 67"
                required
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder:text-white/30 focus:border-[#FF8B01] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">E-post (valfritt)</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                inputMode="email"
                placeholder="namn@exempel.se"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder:text-white/30 focus:border-[#FF8B01] focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-white/70">Ort (valfritt)</label>
              <input
                value={ort}
                onChange={(e) => setOrt(e.target.value)}
                placeholder="T.ex. Katrineholm"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder:text-white/30 focus:border-[#FF8B01] focus:outline-none"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              className="w-full rounded-full bg-[#FF8B01] py-3 text-sm font-semibold text-[#090909] hover:bg-[#FFB347]"
            >
              Skicka intresseanmälan
            </button>
            <p className="text-center text-[11px] text-white/40">
              Din intresseanmälan sparas lokalt på din enhet som backup och skickas via e-post till{" "}
              {CONTACT_EMAIL}.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
