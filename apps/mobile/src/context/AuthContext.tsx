import type { SessionUser } from "@nepal-hand-pay/shared-types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { api } from "../lib/api";

interface RegisterInput {
  role: "CUSTOMER" | "MERCHANT";
  displayName: string;
  email: string;
  phone?: string;
  businessName?: string;
  password: string;
}

interface AuthContextValue {
  user: SessionUser | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(input: RegisterInput): Promise<string | undefined>;
  logout(): Promise<void>;
  refreshUser(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const current = await api.request<SessionUser>("/auth/me");
    setUser(current);
  }, []);

  useEffect(() => {
    api.setUnauthorizedHandler(() => setUser(null));
    void api
      .getCredentials()
      .then((credentials) => {
        if (!credentials) return;
        return refreshUser();
      })
      .catch(() => api.clearSession())
      .finally(() => setLoading(false));
    return () => api.setUnauthorizedHandler(undefined);
  }, [refreshUser]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      async login(email, password) {
        const session = await api.login(email, password);
        setUser(session.user);
      },
      async register(input) {
        const session = await api.register(input);
        setUser(session.user);
        return session.developmentVerificationToken;
      },
      async logout() {
        try {
          await api.logout();
        } finally {
          setUser(null);
        }
      },
      refreshUser,
    }),
    [loading, refreshUser, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
