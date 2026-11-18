"use client";

import { useTheme } from "next-themes";
import { Toaster } from "sonner";

// The toast messages follow the chosen theme.
export function AppToaster() {
  const { resolvedTheme } = useTheme();
  return <Toaster theme={resolvedTheme === "light" ? "light" : "dark"} position="top-center" />;
}
