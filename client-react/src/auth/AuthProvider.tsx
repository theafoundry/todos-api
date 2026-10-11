import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { User } from "../types";
import { apiCall } from "../api/client";
import { navigateWithFade } from "../utils/pageTransitions";
import { clearPrivateBrowserData } from "../utils/privateBrowserData";
import {
  getAuthSession,
  invalidateAuthSession,
  isCurrentAuthSession,
} from "../utils/authSession";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  logout: () => void;
  setUser: (user: User | null) => void;
  setTokens: (token: string, refreshToken: string, user: User) => void;
  refreshUser: () => Promise<User | null>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: () => {},
  setUser: () => {},
  setTokens: () => {},
  refreshUser: async () => null,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    try {
      const stored = localStorage.getItem("user");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const authRevision = useRef(0);

  const persistUser = useCallback((nextUser: User | null) => {
    authRevision.current += 1;
    clearPrivateBrowserData();
    setUser(nextUser);
    if (nextUser) {
      localStorage.setItem("user", JSON.stringify(nextUser));
    } else {
      localStorage.removeItem("user");
    }
  }, []);

  const refreshUser = useCallback(async (): Promise<User | null> => {
    const revision = authRevision.current;
    const session = getAuthSession();
    const res = await apiCall("/users/me");
    if (!res.ok) {
      throw new Error("Failed to fetch user");
    }
    const data = (await res.json()) as User;
    if (revision !== authRevision.current || !isCurrentAuthSession(session)) {
      throw new Error("Your session changed. Please try again.");
    }
    persistUser(data);
    return data;
  }, [persistUser]);

  useEffect(() => {
    clearPrivateBrowserData();
    const token = localStorage.getItem("authToken");
    if (!token) {
      setLoading(false);
      return;
    }

    refreshUser()
      .catch(() => {
        // Keep locally stored user if API fails (offline, etc.)
      })
      .finally(() => setLoading(false));
  }, [refreshUser]);

  const logout = useCallback(() => {
    invalidateAuthSession();
    localStorage.removeItem("authToken");
    localStorage.removeItem("refreshToken");
    persistUser(null);
    navigateWithFade("/", { replace: true });
  }, [persistUser]);

  const setTokens = useCallback(
    (token: string, refreshToken: string, authUser: User) => {
      invalidateAuthSession();
      localStorage.setItem("authToken", token);
      localStorage.setItem("refreshToken", refreshToken);
      persistUser(authUser);
    },
    [persistUser],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        logout,
        setUser: persistUser,
        setTokens,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
