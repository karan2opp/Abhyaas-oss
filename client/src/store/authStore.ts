import { create } from "zustand";
import { getMe, refreshToken, logoutService } from "../app/auth/auth.service";

interface User {
  // The API returns `id` (Postgres/Drizzle). This was typed `_id` from an
  // earlier Mongo-shaped API and never matched the actual response.
  id: string;
  name: string;
  email: string;
  role: 'student' | 'teacher';
  avatarUrl?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoggedIn: boolean;
  loading: boolean;
  error: string | null;
  isInitialized: boolean;

  setUser: (userData: User, token: string | null) => void;
  setAccessToken: (token: string) => void;
  setInitialized: (value: boolean) => void;
  fetchCurrentUser: () => Promise<any>;
  refreshAccessToken: () => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  // ── State (all fields declared upfront) ─────────────
  user: null,              // { _id, name, email, role }
  accessToken: null,       // 🔐 Memory-only (no persist)
  isLoggedIn: false,
  loading: false,
  error: null,
  isInitialized: false,

  // ── Actions ─────────────────────────────────────────

  /**
   * Set user + token after login
   */
  setUser: (userData, token) => {
    set({
      user: userData,
      accessToken: token,
      isLoggedIn: true,
      isInitialized: true,
      loading: false,
      error: null,
    });
  },

  /**
   * Update access token only
   */
  setAccessToken: (token) => set({ accessToken: token }),

  setInitialized: (value) => set({ isInitialized: value }),

  /**
   * Fetch current user from API
   */
  fetchCurrentUser: async () => await getMe(set),

  /**
   * Refresh access token
   */
  refreshAccessToken: () => refreshToken(set),

  /**
   * Logout — clear all auth state
   */
  logout: () => logoutService(set),

  // ── Optional: Helper to clear error ─────────────────
  clearError: () => set({ error: null }),
}));

// ── Helper Hooks (for components) ─────────────────────
export const useUserRole = () =>
  useAuthStore((state) => state.user?.role);
