/**
 * PetitionModal — kommunbaserad kampanjformulär.
 *
 * Kampanjkonfigurationen avgör vilken text och e-postadress som visas.
 * Formuläret kräver att en kommun är vald innan det går att skicka.
 * Inledningsvis stöds bara Katrineholm.
 */
import { useEffect, useState } from "react";

// ─── Kampanjkonfiguration ─────────────────────────────────────────────────────

interface Campaign {
  municipality: string;
  enabled: boolean;
  title: string;
  description: string;
  contactEmail: string;
  privacyText: string;
  submitLabel: string;
  thankYouMessage: string;
}

const CAMPAIGNS: Record<string, Campaign> = {
  katrineholm: {
    municipality: "Katrineholm",
    enabled: true,
    title: "Folkomröstning om vindkraft 2026",
    description:
      "En giltig namninsamling för en kommunal folkomröstning kräver underskrifter på papper. " +
      "Skicka in din intresseanmälan så kontaktar Katrineholm FRAMÅT dig med information om hur och var du kan skriva under.",
    contactEmail: "info@katrineholmframat.se",
    privacyText:
      "Din intresseanmälan sparas lokalt på din enhet som backup och skickas via e-post till info@katrineholmframat.se.",
    submitLabel: "Skicka intresseanmälan",
    thankYouMessage:
      "Tack! Katrineholm FRAMÅT kommer att kontakta dig med information om hur du kan skriva under namninsamlingen på papper.",
  },
};

const ENABLED_MUNICIPALITIES = Object.entries(CAMPAIGNS)
  .filter(([, c]) => c.enabled)
  .map(([key, c]) => ({ key, label: c.municipality }));

// ─── Lagring ─────────────────────────────────────────────────────────────────

const STORAGE_KEY = "vindkraft-ar-katrineholm:signatures";

interface Signature {
  name: string;
  phone: string;
  email: string;
  ort: string;
  municipality: string;
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

function buildMailto(entry: Signature, campaign: Campaign): string {
  const subject = encodeURIComponent(
    `Intresseanmälan – ${campaign.title} – ${entry.municipality}`
  );
  const body = encodeURIComponent(
    [
      `Kommun: ${entry.municipality}`,
      `För- och efternamn: ${entry.name}`,
      `Telefonnummer: ${entry.phone}`,
      `E-post: ${entry.email || "–"}`,
      `Ort: ${entry.ort || "–"}`,
      "",
      `Skickat: ${new Date(entry.timestamp).toLocaleString("sv-SE")}`,
    ].join("\n")
  );
  return `mailto:${campaign.contactEmail}?subject=${subject}&body=${body}`;
}

// ─── Komponent ───────────────────────────────────────────────────────────────

export function PetitionModal({ onClose }: { onClose: () => void }) {
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [municipalityKey, setMunicipalityKey] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [ort, setOrt] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setSignatures(loadSignatures()); }, []);

  const campaign = municipalityKey ? CAMPAIGNS[municipalityKey] ?? null : null;
  const canSubmit = !!campaign;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!campaign) { setError("Välj en kommun först."); return; }
    if (name.trim().length < 2) { setError("Ange för- och efternamn."); return; }
    if (phone.trim().length < 4) { setError("Ange ditt telefonnummer."); return; }

    const entry: Signature = {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      ort: ort.trim(),
      municipality: campaign.municipality,
      timestamp: Date.now(),
    };

    const next = [...signatures, entry];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSignatures(next);
    window.location.href = buildMailto(entry, campaign);
    setSubmitted(true);
    setError(null);
  }

  const inputClass =
    "w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-white placeholder:text-white/30 focus:border-[#FF8B01] focus:outline-none";
  const labelClass = "mb-1 block text-xs font-medium text-white/70";

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center overflow-y-auto bg-black/70 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-[#111111] p-6 shadow-2xl sm:rounded-3xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">
              {campaign ? campaign.title : "Skriv under för folkomröstning"}
            </h2>
            {campaign && (
              <p className="mt-2 text-sm text-white/70">{campaign.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20"
          >
            ✕
          </button>
        </div>

        {submitted && campaign ? (
          /* Tack-vy */
          <div className="rounded-2xl bg-[#FF8B01]/10 p-5 text-center">
            <p className="text-lg font-medium text-white">{campaign.thankYouMessage}</p>
            <p className="mt-1 text-sm text-white/60">
              {signatures.length}{" "}
              {signatures.length === 1 ? "person har" : "personer har"} anmält intresse på den
              här enheten.
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
            {/* Kommunval — obligatoriskt */}
            <div>
              <label className={labelClass}>Välj kommun *</label>
              <select
                value={municipalityKey}
                onChange={e => { setMunicipalityKey(e.target.value); setError(null); }}
                className={`${inputClass} appearance-none`}
                required
              >
                <option value="">Välj kommun…</option>
                {ENABLED_MUNICIPALITIES.map(({ key, label }) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>

            {/* Formulärfält — visas bara när kommun är vald */}
            {campaign && (
              <>
                <div>
                  <label className={labelClass}>För- och efternamn *</label>
                  <input
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="För- och efternamn"
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Telefonnummer *</label>
                  <input
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    type="tel"
                    inputMode="tel"
                    placeholder="T.ex. 070-123 45 67"
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>E-post (valfritt)</label>
                  <input
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    type="email"
                    inputMode="email"
                    placeholder="namn@exempel.se"
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Ort (valfritt)</label>
                  <input
                    value={ort}
                    onChange={e => setOrt(e.target.value)}
                    placeholder="T.ex. Katrineholm"
                    className={inputClass}
                  />
                </div>
              </>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-full bg-[#FF8B01] py-3 text-sm font-semibold text-[#090909] hover:bg-[#FFB347] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {canSubmit ? (campaign!.submitLabel) : "Välj först kommun"}
            </button>

            {campaign && (
              <p className="text-center text-[11px] text-white/40">{campaign.privacyText}</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
