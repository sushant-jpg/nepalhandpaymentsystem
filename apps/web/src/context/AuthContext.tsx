import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { SessionUser } from "@nepal-hand-pay/shared-types";
import { api, setToken } from "../lib/api";

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: Record<string, unknown>): Promise<string | undefined>;
  logout(): Promise<void>;
  refreshUser(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshUser = useCallback(async () => {
    try { setUser(await api.get<SessionUser>("/auth/me")); } catch { setToken(null); setUser(null); }
  }, []);
  useEffect(() => { refreshUser().finally(() => setLoading(false)); }, [refreshUser]);

  const value = useMemo<AuthContextValue>(() => ({
    user, loading,
    login: async (email, password) => {
      const result = await api.post<{ accessToken: string; user: SessionUser }>("/auth/login", { email, password });
      setToken(result.accessToken); setUser(result.user);
    },
    register: async (input) => {
      const result = await api.post<{ accessToken: string; user: SessionUser; developmentVerificationToken?: string }>("/auth/register", input);
      setToken(result.accessToken); setUser(result.user); return result.developmentVerificationToken;
    },
    logout: async () => { try { await api.post("/auth/logout"); } finally { setToken(null); setUser(null); } },
    refreshUser,
  }), [user, loading, refreshUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
