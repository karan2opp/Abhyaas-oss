"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

/**
 * Light / dark switch for the app screens. Shows the mode you would switch to; the choice is remembered on the device.
 * `label` adds the words next to the icon (for sidebars).
 */
export function ThemeSwitch({ label = false, className }: { label?: boolean; className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  // The saved theme is only known in the browser, so the icon waits until the page has loaded.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const light = mounted && resolvedTheme === "light";
  const next = light ? "dark" : "light";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn("inline-flex items-center justify-center gap-2 rounded-lg p-2 text-xs font-medium text-gray-400 transition-colors hover:bg-white/10 hover:text-white", className)}
    >
      {light ? <Moon className="h-4 w-4 shrink-0" /> : <Sun className="h-4 w-4 shrink-0" />}
      {label && <span className="whitespace-nowrap">{light ? "Dark theme" : "Light theme"}</span>}
    </button>
  );
}
