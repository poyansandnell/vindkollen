/**
 * Hjälpfunktion för API-URL:er.
 *
 * Webb (Replit-deployment): VITE_API_BASE_URL är tom → relativa URL:er (/api/...)
 * Native (Capacitor iOS/Android): VITE_API_BASE_URL=https://din-produktion.repl.co
 *
 * Exempel:
 *   apiUrl("/api/auth/user")
 *   // webb  → "/api/auth/user"
 *   // native → "https://din-produktion.repl.co/api/auth/user"
 */
const API_BASE: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  // Undvik dubbla snedstreck
  return `${API_BASE.replace(/\/$/, "")}${path}`;
}
