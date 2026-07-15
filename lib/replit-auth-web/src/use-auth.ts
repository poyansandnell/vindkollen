import { useState, useEffect, useCallback } from "react";
import type { AuthUser } from "@workspace/api-client-react";

export type { AuthUser };

// VITE_API_BASE_URL sätts vid byggtid för native (Capacitor iOS/Android).
// Webb-bygget lämnar den tom → relativa URL:er fungerar som förut.
const _apiBase: string = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
function _api(path: string): string {
  return _apiBase ? `${_apiBase.replace(/\/$/, "")}${path}` : path;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(_api("/api/auth/user"), { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<{ user: AuthUser | null }>;
      })
      .then((data) => {
        if (!cancelled) {
          setUser(data.user ?? null);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(() => {
    const base = import.meta.env.BASE_URL?.replace(/\/+$/, "") || "/";
    window.location.href = _api(`/api/login?returnTo=${encodeURIComponent(base)}`);
  }, []);

  const logout = useCallback(() => {
    window.location.href = _api("/api/logout");
  }, []);

  return {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
  };
}
