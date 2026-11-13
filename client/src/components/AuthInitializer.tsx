"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import { useAuthStore } from "@/store/authStore";

// Keeps the app's own user record in step with Clerk: when Clerk says someone is signed in, their profile and role are
// loaded from the API; when nobody is, the record is cleared.
export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const fetchCurrentUser = useAuthStore((state) => state.fetchCurrentUser);
  const setInitialized = useAuthStore((state) => state.setInitialized);

  useEffect(() => {
    if (!isLoaded) return;

    if (!isSignedIn) {
      useAuthStore.setState({ user: null, isLoggedIn: false });
      setInitialized(true);
      return;
    }

    // Pages decide who may see them only once this has finished, so a person who has just signed in is not sent back to
    // the sign-in page before their profile arrives.
    setInitialized(false);
    fetchCurrentUser().finally(() => setInitialized(true));
  }, [isLoaded, isSignedIn, fetchCurrentUser, setInitialized]);

  // We don't block rendering here so public pages load instantly.
  // For protected routes, the layouts wait for `isInitialized` from the store.
  return <>{children}</>;
}
