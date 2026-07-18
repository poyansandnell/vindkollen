import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@workspace/replit-auth-web";
import { apiUrl } from "@/lib/apiUrl";

const SAVED_KEY = "vindkraft-ar-katrineholm:savedPlacements";
const EDIT_HANDOFF_KEY = "vindkraft:editHandoff";

interface LocalProject {
  id: string;
  name: string;
  timestamp: number;
  turbines: { id: string; lat: number; lon: number }[];
  totalScore: number;
}

interface ApiProject {
  id: string;
  name: string;
  location?: string | null;
  municipality?: string | null;
  turbines: { id: string; lat: number; lon: number }[];
  totalScore?: string | null;
  turbineCount: string;
  shareToken?: string | null;
  centerLat?: string | null;
  centerLng?: string | null;
  createdAt: string;
  updatedAt: string;
}

function loadLocalProjects(): LocalProject[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? (JSON.parse(raw) as LocalProject[]) : [];
  } catch {
    return [];
  }
}

export default function MyProjects() {
  const [, navigate] = useLocation();
  const { user, isLoading, isAuthenticated, login } = useAuth();
  const [apiProjects, setApiProjects] = useState<ApiProject[]>([]);
  const [localProjects, setLocalProjects] = useState<LocalProject[]>([]);
  const [loadingApi, setLoadingApi] = useState(false);
  const [deleteFlash, setDeleteFlash] = useState<string | null>(null);
  const [shareFlash, setShareFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLocalProjects(loadLocalProjects());
  }, []);

  const fetchApiProjects = useCallback(async () => {
    setLoadingApi(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/projects"), { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ApiProject[];
      setApiProjects(data);
    } catch {
      setError("Kunde inte hämta projekt. Kontrollera din anslutning.");
    } finally {
      setLoadingApi(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchApiProjects();
    }
  }, [isAuthenticated, fetchApiProjects]);

  function handleLoadApiProject(p: ApiProject) {
    const handoff = {
      projectName: p.name,
      turbines: (p.turbines as { id: string; lat: number; lon: number }[]).map((t) => ({
        id: t.id,
        lat: t.lat,
        lon: t.lon,
      })),
      centerLat: p.centerLat ? parseFloat(p.centerLat) : null,
      centerLng: p.centerLng ? parseFloat(p.centerLng) : null,
      savedAt: Date.now(),
    };
    localStorage.setItem(EDIT_HANDOFF_KEY, JSON.stringify(handoff));
    navigate("/placera");
  }

  function handleLoadLocalProject(p: LocalProject) {
    const handoff = {
      projectName: p.name,
      turbines: p.turbines,
      centerLat: null,
      centerLng: null,
      savedAt: Date.now(),
    };
    localStorage.setItem(EDIT_HANDOFF_KEY, JSON.stringify(handoff));
    navigate("/placera");
  }

  async function handleDeleteApiProject(id: string) {
    try {
      const res = await fetch(apiUrl(`/api/projects/${id}`), { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) throw new Error();
      setApiProjects((prev) => prev.filter((p) => p.id !== id));
      setDeleteFlash(id);
      setTimeout(() => setDeleteFlash(null), 1500);
    } catch {
      setError("Kunde inte ta bort projektet.");
    }
  }

  function handleDeleteLocalProject(id: string) {
    const next = localProjects.filter((p) => p.id !== id);
    localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    setLocalProjects(next);
  }

  async function handleShare(id: string) {
    try {
      const res = await fetch(apiUrl(`/api/projects/${id}/share`), {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { shareUrl: string };

      if (navigator.share) {
        try {
          await navigator.share({
            title: "Mitt vindkraftprojekt i Vindkollen",
            text: "Kolla min placering av vindkraftverk:",
            url: data.shareUrl,
          });
          setShareFlash(id);
          setTimeout(() => setShareFlash(null), 2000);
          return;
        } catch (err) {
          if ((err as Error).name === "AbortError") return;
          // Annan fel → fall tillbaka till urklipp
        }
      }

      await navigator.clipboard.writeText(data.shareUrl);
      setShareFlash(id);
      setTimeout(() => setShareFlash(null), 2000);
    } catch {
      setError("Kunde inte generera delningslänk.");
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090909] text-white pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <p className="text-white/50">Laddar…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090909] text-white pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <button
            onClick={() => navigate("/placera")}
            className="flex items-center gap-1 text-sm text-white/50 hover:text-white"
          >
            ← Tillbaka
          </button>
          <h1 className="text-xl font-semibold">Mina projekt</h1>
          <div className="w-16" />
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-900/30 px-4 py-3 text-sm text-red-300">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline">
              Stäng
            </button>
          </div>
        )}

        {/* Molnprojekt (inloggad) */}
        {isAuthenticated ? (
          <section className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-white/70">
                ☁️ Sparade projekt · {user?.firstName ?? ""}
              </h2>
              <button
                onClick={fetchApiProjects}
                className="text-xs text-white/40 hover:text-white/70"
              >
                Uppdatera
              </button>
            </div>

            {loadingApi ? (
              <p className="text-sm text-white/40">Hämtar…</p>
            ) : apiProjects.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center">
                <p className="text-sm text-white/40">Inga sparade molnprojekt ännu.</p>
                <button
                  onClick={() => navigate("/placera")}
                  className="mt-3 rounded-full bg-[#FF8B01] px-5 py-2 text-sm font-semibold text-[#090909]"
                >
                  Skapa placering
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {apiProjects.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div className="mb-1 flex items-start justify-between">
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-white/40">
                          {p.turbineCount} verk
                          {p.totalScore ? ` · Påverkan ${p.totalScore}` : ""}
                          {p.location ? ` · ${p.location}` : ""}
                        </p>
                        <p className="text-xs text-white/30">
                          {new Date(p.updatedAt).toLocaleDateString("sv-SE")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleLoadApiProject(p)}
                          className="rounded-full bg-[#FF8B01] px-3 py-1 text-xs font-semibold text-[#090909]"
                        >
                          Redigera
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => handleShare(p.id)}
                        className="rounded-full border border-white/20 bg-white/5 px-3 py-1 text-xs text-white/70 hover:bg-white/10"
                      >
                        {shareFlash === p.id ? "✅ Kopierad!" : "🔗 Dela länk"}
                      </button>
                      <button
                        onClick={() => handleDeleteApiProject(p.id)}
                        className="rounded-full border border-red-900/40 bg-red-900/20 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30"
                      >
                        {deleteFlash === p.id ? "Borttagen" : "Ta bort"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          <section className="mb-8">
            <div className="rounded-xl border border-white/10 bg-white/5 px-6 py-8 text-center">
              <p className="mb-2 text-lg font-semibold">Logga in för att spara i molnet</p>
              <p className="mb-5 text-sm text-white/50">
                Dina placeringar sparas säkert och kan nås från alla enheter.
              </p>
              <button
                onClick={login}
                className="rounded-full bg-[#FF8B01] px-6 py-2.5 text-sm font-semibold text-[#090909]"
              >
                Logga in
              </button>
            </div>
          </section>
        )}

        {/* Lokalt sparade (anonyma) */}
        {localProjects.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-medium text-white/70">
              📱 Lokalt sparade (på denna enhet)
            </h2>
            <div className="space-y-3">
              {localProjects
                .slice()
                .sort((a, b) => b.timestamp - a.timestamp)
                .map((p) => (
                  <div
                    key={p.id}
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{p.name}</p>
                        <p className="text-xs text-white/40">
                          {p.turbines.length} verk · Poäng {Math.round(p.totalScore)}
                        </p>
                        <p className="text-xs text-white/30">
                          {new Date(p.timestamp).toLocaleDateString("sv-SE")}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleLoadLocalProject(p)}
                          className="rounded-full bg-[#FF8B01] px-3 py-1 text-xs font-semibold text-[#090909]"
                        >
                          Redigera
                        </button>
                        <button
                          onClick={() => handleDeleteLocalProject(p.id)}
                          className="rounded-full border border-red-900/40 bg-red-900/20 px-3 py-1 text-xs text-red-400 hover:bg-red-900/30"
                        >
                          Ta bort
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
            {!isAuthenticated && localProjects.length > 0 && (
              <p className="mt-3 text-xs text-white/30">
                Logga in för att synkronisera lokala projekt till molnet och nå dem från andra
                enheter.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
