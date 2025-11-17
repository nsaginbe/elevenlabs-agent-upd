import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchCurrentUser, login as loginRequest } from "../api";
import { getAuthToken, setAuthToken } from "../auth";
import type { LoginRequest, User } from "../types";

type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [token, setTokenState] = useState<string | null>(() => getAuthToken());

  const setToken = useCallback((nextToken: string | null) => {
    setTokenState(nextToken);
    setAuthToken(nextToken);
  }, []);

  const loadCurrentUser = useCallback(async () => {
    if (!getAuthToken()) {
      setUser(null);
      setStatus("unauthenticated");
      return;
    }

    setStatus("loading");
    setError(null);
    try {
      const me = await fetchCurrentUser();
      setUser(me);
      setStatus("authenticated");
    } catch (err) {
      console.error("[Auth] Failed to load current user", err);
      setUser(null);
      setStatus("unauthenticated");
      setToken(null);
    }
  }, [setToken]);

  useEffect(() => {
    void loadCurrentUser();
  }, [loadCurrentUser, token]);

  const login = useCallback(async (credentials: LoginRequest) => {
    setStatus("loading");
    setError(null);
    try {
      const result = await loginRequest({
        username: credentials.username.trim(),
        password: credentials.password
      });
      setToken(result.access_token);
      await loadCurrentUser();
    } catch (err) {
      console.error("[Auth] Login failed", err);
      setStatus("unauthenticated");
      setError(err instanceof Error ? err.message : "Не удалось выполнить вход");
      throw err;
    }
  }, [loadCurrentUser, setToken]);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    setStatus("unauthenticated");
    setError(null);
  }, [setToken]);

  const isLoading = status === "loading";
  const isAuthenticated = status === "authenticated";

  return useMemo(
    () => ({
      user,
      token,
      login,
      logout,
      isAuthenticated,
      isLoading,
      error,
      status
    }),
    [user, token, login, logout, isAuthenticated, isLoading, error, status]
  );
}

