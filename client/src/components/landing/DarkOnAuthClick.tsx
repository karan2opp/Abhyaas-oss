"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/** The landing page is light, the product is dark. Clicking Login or Get started (any link into /auth) switches to dark. */
export function DarkOnAuthClick() {
  const { setTheme } = useTheme();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest?.("a");
      if (link?.getAttribute("href")?.startsWith("/auth")) setTheme("dark");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [setTheme]);

  return null;
}
