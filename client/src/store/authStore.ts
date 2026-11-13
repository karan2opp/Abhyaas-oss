import { create } from "zustand";
import { getMe, logoutService } from "../app/auth/auth.service";

interface User {
  // The API returns `id` (Postgres/Drizzle). This was typed `_id` from an
  // earlier Mongo-shaped API and never matched the actual response.
  id: string;
  name: string;
  email: string;
  role: 'student' | 'teacher';
  // False until a new user has chosen student or teacher (see /onboarding).
  onboarded: boolean;
  avatarUrl?: string;
  // The 10-digit number on the account, if any. Needed to pay (Cashfree requires one for the payer).
  phone?: string | null;
}

// Signing in is handled by Clerk. This only holds the app's own record of the signed-in person (their role and profile),
// which AuthInitializer loads from /auth/me once Clerk says someone is signed in.
interface AuthState {
  user: User | null;
  isLoggedIn: boolean;
  loading: boolean;
  error: string | null;
  isInitialized: boolean;

  setUser: (userData: User) => void;
  setInitialized: (value: boolean) => void;
  fetchCurrentUser: () => Promise<any>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoggedIn: false,
  loading: false,
  error: null,
  isInitialized: false,

  setUser: (userData) => {
    set({
      user: userData,
      isLoggedIn: true,
      isInitialized: true,
      loading: false,
      error: null,
    });
  },

  setInitialized: (value) => set({ isInitialized: value }),

  fetchCurrentUser: async () => await getMe(set),

  /** Signs out of Clerk and clears the app's record of the user. */
  logout: () => logoutService(set),

  clearError: () => set({ error: null }),
}));

// ── Helper Hooks (for components) ─────────────────────
export const useUserRole = () =>
  useAuthStore((state) => state.user?.role);
