/**
 * Hjälpfunktioner för URL:er — centraliserad konfiguration.
 *
 * API-anrop:
 *   Webb (Replit-deployment): VITE_API_BASE_URL är tom → relativa URL:er (/api/...)
 *   Native (Capacitor iOS/Android): VITE_API_BASE_URL=https://app.vindkollen.com
 *
 * Publika applikationslänkar (delning, callbacks):
 *   VITE_PUBLIC_APP_URL=https://app.vindkollen.com
 *   Tom = window.location.origin (fungerar i webbläsare, inte i native)
 *
 * Exempel:
 *   apiUrl("/api/auth/user")
 *   // webb   → "/api/auth/user"
 *   // native → "https://app.vindkollen.com/api/auth/user"
 *
 *   publicUrl("/placera?shareToken=abc")
 *   // webb   → "https://katrineholm.replit.app/placera?shareToken=abc"
 *   // native → "https://app.vindkollen.com/placera?shareToken=abc"
 */

const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
const PUBLIC_BASE: string = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined) ?? "";

export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  return `${API_BASE.replace(/\/$/, "")}${path}`;
}

/** Bygger en publik delningslänk. Faller tillbaka på window.location.origin i webbläsaren. */
export function publicUrl(path: string): string {
  const base = PUBLIC_BASE || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base.replace(/\/$/, "")}${path}`;
}
