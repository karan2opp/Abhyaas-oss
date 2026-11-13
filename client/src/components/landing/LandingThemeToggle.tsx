"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

type ViewTransitionDoc = Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } };

/**
 * The sun/moon button in the landing nav. It uses the app's own theme, so the choice carries into the product.
 *
 * Switching is animated: the new theme grows as a circle out of the button. Where the browser can't do that, the colours
 * fade over half a second instead. For anyone who asked for less motion the theme just switches.
 */
export function LandingThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const reduceMotion = useReducedMotion();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // First-time visitors start on the light page, whatever their device uses. (The same is done before the first paint by
    // the small script in page.tsx; this covers arriving here by clicking a link inside the app.)
    try {
      if (!localStorage.getItem("theme")) setTheme("light");
    } catch {
      // storage can be blocked; the page then just follows the device
    }
  }, [setTheme]);

  const dark = mounted && resolvedTheme === "dark";

  const switchTheme = () => {
    const next = dark ? "light" : "dark";
    const root = document.documentElement;
    // Put the new theme on the page straight away (next-themes would do the same a moment later) so that the "after" picture
    // the browser takes already shows it.
    const apply = () => {
      root.classList.toggle("dark", next === "dark");
      root.style.colorScheme = next;
      setTheme(next);
    };

    const doc = document as ViewTransitionDoc;
    if (reduceMotion) {
      apply();
      return;
    }
    if (!doc.startViewTransition || !buttonRef.current) {
      root.classList.add("theme-fading");
      apply();
      window.setTimeout(() => root.classList.remove("theme-fading"), 600);
      return;
    }

    const box = buttonRef.current.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const transition = doc.startViewTransition(apply);
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 750, easing: "cubic-bezier(0.22, 1, 0.36, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    });
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={switchTheme}
      aria-label={dark ? "Switch to the light theme" : "Switch to the dark theme"}
      className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border transition-colors hover:bg-[rgb(var(--l-ink-rgb)/0.07)]"
      style={{ borderColor: "rgb(var(--l-ink-rgb) / 0.18)" }}
    >
      {/* the icons spin into each other */}
      <AnimatePresence mode="wait" initial={false}>
        {mounted && (
          <motion.span
            key={dark ? "sun" : "moon"}
            initial={reduceMotion ? false : { rotate: -90, scale: 0.4, opacity: 0 }}
            animate={{ rotate: 0, scale: 1, opacity: 1 }}
            exit={reduceMotion ? undefined : { rotate: 90, scale: 0.4, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="grid place-items-center"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
