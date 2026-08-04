/**
 * PushAdmin — /push-admin
 *
 * Enkel skyddad sida för att skicka push-notiser till alla prenumeranter.
 * Autentisering via PUSH_ADMIN_SECRET (lösenord som anges i sidans formulär,
 * sparas i sessionStorage så att det inte behöver anges varje gång).
 */

import { useState } from "react";

const SECRET_KEY = "vindkollen:pushAdminSecret";

export default function PushAdmin() {
  const [secret, setSecret] = useState(() => sessionStorage.getItem(SECRET_KEY) ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/");
  const [status, setStatus] = useState<{ type: "ok" | "error"; message: string } | null>(null);
  const [sending, setSending] = useState(false);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!secret || !title || !body) return;
    setSending(true);
    setStatus(null);
    sessionStorage.setItem(SECRET_KEY, secret);
    try {
      const res = await fetch("/api/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-secret": secret,
        },
        body: JSON.stringify({ title, body, url }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        sent?: number;
        failed?: number;
        removed?: number;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setStatus({ type: "error", message: data.error ?? `HTTP ${res.status}` });
      } else {
        setStatus({
          type: "ok",
          message: `✅ Skickat till ${data.sent} prenumeranter. Misslyckades: ${data.failed ?? 0}. Borttagna (utgångna): ${data.removed ?? 0}.`,
        });
        setTitle("");
        setBody("");
        setUrl("/");
      }
    } catch (e) {
      setStatus({ type: "error", message: String(e) });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0e2a22] text-white flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">📬 Push-notiser</h1>
          <p className="text-white/60 text-sm">
            Skicka ett meddelande till alla som har installerat appen och godkänt notiser.
          </p>
        </div>

        <form onSubmit={(e) => void handleSend(e)} className="space-y-4">
          {/* Lösenord */}
          <div>
            <label className="block text-sm font-medium mb-1 text-white/80">Lösenord</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              required
              placeholder="PUSH_ADMIN_SECRET"
              className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>

          {/* Rubrik */}
          <div>
            <label className="block text-sm font-medium mb-1 text-white/80">Rubrik</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={80}
              placeholder="t.ex. Webbmöte imorgon kl 19"
              className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
            <p className="text-xs text-white/40 mt-1">{title.length}/80</p>
          </div>

          {/* Meddelande */}
          <div>
            <label className="block text-sm font-medium mb-1 text-white/80">Meddelande</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              required
              maxLength={200}
              rows={3}
              placeholder="t.ex. Vi ses på Zoom — länk i beskrivningen."
              className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-400 resize-none"
            />
            <p className="text-xs text-white/40 mt-1">{body.length}/200</p>
          </div>

          {/* URL (valfri) */}
          <div>
            <label className="block text-sm font-medium mb-1 text-white/80">
              Länk vid klick <span className="text-white/40">(valfri)</span>
            </label>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/"
              className="w-full rounded-lg bg-white/10 border border-white/20 px-3 py-2 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>

          {/* Status */}
          {status && (
            <div
              className={`rounded-lg px-4 py-3 text-sm ${
                status.type === "ok"
                  ? "bg-emerald-800/60 text-emerald-200"
                  : "bg-red-900/60 text-red-200"
              }`}
            >
              {status.message}
            </div>
          )}

          <button
            type="submit"
            disabled={sending || !secret || !title || !body}
            className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed py-3 font-semibold transition-colors"
          >
            {sending ? "Skickar…" : "Skicka till alla"}
          </button>
        </form>

        <p className="text-center text-xs text-white/30">
          Den här sidan är inte länkad från appen. Dela bara URL:en med betrodda personer.
        </p>
      </div>
    </div>
  );
}
