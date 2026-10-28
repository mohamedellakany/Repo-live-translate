import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError, setApiToken, type AuthResult, type GoogleResult, type User } from "@/lib/api";
import { storage } from "@/lib/storage";

const TOKEN_KEY = "lt.token";

interface AuthState {
  user: User | null;
  token: string | null;
  ready: boolean;
  signIn: (login: string, password: string) => Promise<User>;
  signUp: (input: { username: string; email: string; displayName: string; password: string }) => Promise<User>;
  /** Returns the user when signed in, or the pending profile when a new account still needs a speaker ID. */
  signInWithGoogle: (idToken: string) => Promise<GoogleResult>;
  completeGoogleSignUp: (input: { signupToken: string; username: string; displayName: string }) => Promise<User>;
  verifyEmail: (code: string) => Promise<User>;
  resetPassword: (input: { email: string; code: string; password: string }) => Promise<User>;
  signOut: () => Promise<void>;
  deleteAccount: (confirm: { password?: string; confirmUsername?: string }) => Promise<void>;
  updateDisplayName: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const apply = useCallback(async (next: AuthResult | null) => {
    setApiToken(next?.token ?? null);
    setToken(next?.token ?? null);
    setUser(next?.user ?? null);
    if (next) await storage.set(TOKEN_KEY, next.token);
    else await storage.remove(TOKEN_KEY);
    return next?.user ?? null;
  }, []);

  // Restore session on launch.
  useEffect(() => {
    (async () => {
      const saved = await storage.get(TOKEN_KEY);
      if (saved) {
        setApiToken(saved);
        try {
          const { user } = await api.me();
          setToken(saved);
          setUser(user);
        } catch (e) {
          // Only forget the token if the server rejected it, not on network errors.
          if (e instanceof ApiError && e.status === 401) await apply(null);
          else setToken(saved);
        }
      }
      setReady(true);
    })();
  }, [apply]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      token,
      ready,
      signIn: async (login, password) => (await apply(await api.login(login, password)))!,
      signUp: async (input) => (await apply(await api.register(input)))!,
      signInWithGoogle: async (idToken) => {
        const res = await api.google(idToken);
        if ("token" in res) await apply(res);
        return res;
      },
      completeGoogleSignUp: async (input) => (await apply(await api.googleComplete(input)))!,
      verifyEmail: async (code) => {
        const { user } = await api.verifyEmail(code);
        setUser(user);
        return user;
      },
      resetPassword: async (input) => (await apply(await api.resetPassword(input)))!,
      signOut: async () => void (await apply(null)),
      deleteAccount: async (confirm) => {
        await api.deleteAccount(confirm);
        await apply(null);
      },
      updateDisplayName: async (name) => setUser((await api.updateMe(name)).user),
      refresh: async () => setUser((await api.me()).user),
    }),
    [user, token, ready, apply],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
