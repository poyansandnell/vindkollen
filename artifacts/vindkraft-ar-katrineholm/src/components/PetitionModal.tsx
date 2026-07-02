import { useEffect, useState } from "react";

const STORAGE_KEY = "vindkraft-ar-katrineholm:signatures";

interface Signature {
  name: string;
  postort: string;
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

export function PetitionModal({ onClose }: { onClose: () => void }) {
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [name, setName] = useState("");
  const [postort, setPostort] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSignatures(loadSignatures());
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Ange ditt namn för att skriva under.");
      return;
    }
    const next = [...signatures, { name: name.trim(), postort: postort.trim(), timestamp: Date.now() }];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSignatures(next);
    setSubmitted(true);
    setError(null);
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-md rounded-t-3xl bg-[#0f2620] p-6 shadow-2xl sm:rounded-3xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold text-emerald-50">Folkomröstning om vindkraft</h2>
            <p className="mt-1 text-sm text-emerald-200/70">
              Katrineholms kommun höll en folkomröstning 2022 om vindkraft i kommunens skogar. Skriv under för att
              visa ditt engagemang inför framtida beslut om vindkraftsutbyggnaden norr om staden.
            </p>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-full bg-white/10 p-1.5 text-emerald-50 hover:bg-white/20">
            ✕
          </button>
        </div>

        {submitted ? (
          <div className="rounded-2xl bg-emerald-500/10 p-5 text-center">
            <p className="text-lg font-medium text-emerald-100">Tack för ditt engagemang!</p>
            <p className="mt-1 text-sm text-emerald-200/70">
              {signatures.length} {signatures.length === 1 ? "person har" : "personer har"} skrivit under hittills på den här enheten.
            </p>
            <button
              onClick={onClose}
              className="mt-4 rounded-full bg-emerald-500 px-6 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
            >
              Stäng
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-emerald-200/70">Namn</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="För- och efternamn"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-emerald-50 placeholder:text-emerald-200/30 focus:border-emerald-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-emerald-200/70">Ort (valfritt)</label>
              <input
                value={postort}
                onChange={(e) => setPostort(e.target.value)}
                placeholder="T.ex. Katrineholm"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-emerald-50 placeholder:text-emerald-200/30 focus:border-emerald-400 focus:outline-none"
              />
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              type="submit"
              className="w-full rounded-full bg-emerald-500 py-3 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
            >
              Skriv under
            </button>
            <p className="text-center text-[11px] text-emerald-200/40">
              Din underskrift sparas lokalt på din enhet i den här demoversionen.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
