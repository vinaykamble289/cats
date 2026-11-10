import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { api } from "./api";
import type { Role, User } from "./types";

interface AuthState {
  session: Session | null;
  /** cats profile (role etc.). undefined while loading. */
  me: User | undefined;
  loading: boolean;
  error: Error | null;
  signOut: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
  /** admin or recruiter */
  isHR: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) qc.clear();
    });
    return () => sub.subscription.unsubscribe();
  }, [qc]);

  const meQuery = useQuery({
    queryKey: ["me", session?.user.id],
    queryFn: () => api.get<User>("/me"),
    enabled: !!session,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const value = useMemo<AuthState>(() => {
    const me = meQuery.data;
    const hasRole = (...roles: Role[]) =>
      !!me && (me.role === "admin" || roles.includes(me.role));
    return {
      session,
      me,
      loading: !ready || (!!session && meQuery.isLoading),
      error: (meQuery.error as Error) ?? null,
      signOut: async () => {
        await supabase.auth.signOut();
        qc.clear();
      },
      hasRole,
      isHR: hasRole("recruiter"),
    };
  }, [session, ready, meQuery.data, meQuery.isLoading, meQuery.error, qc]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
