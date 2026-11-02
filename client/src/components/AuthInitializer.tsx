"use client";

import { useEffect, useRef } from "react";
import { useAuthStore } from "@/store/authStore";

export function AuthInitializer({ children }: { children: React.ReactNode }) {
  const fetchCurrentUser = useAuthStore((state) => state.fetchCurrentUser);
  const setInitialized = useAuthStore((state) => state.setInitialized);
  const isInitialized = useAuthStore((state) => state.isInitialized);
  
  const hasFetched = useRef(false);

  useEffect(() => {
    // Only attempt to fetch the user once when the app mounts
    if (!hasFetched.current && !isInitialized) {
      hasFetched.current = true;
      fetchCurrentUser().finally(() => {
        setInitialized(true);
      });
    }
  }, [fetchCurrentUser, isInitialized, setInitialized]);

  // We don't block rendering here so public pages load instantly.
  // For protected routes, you can use the `isInitialized` state from Zustand 
  // to show a loading spinner if needed.
  return <>{children}</>;
}
