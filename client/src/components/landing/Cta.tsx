import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { C } from "./palette";

/** The two buttons used in the hero: the main action and a quiet jump to the explanation. */
export function CtaButtons({ onDark = false }: { onDark?: boolean }) {
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      <Link
        href="/auth/login"
        className="group inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-base font-bold text-white transition-transform hover:-translate-y-0.5"
        style={{ background: C.orange, boxShadow: "0 10px 24px -10px rgba(242,106,27,0.9)" }}
      >
        Get started free <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </Link>
      <a
        href="#how-it-works"
        className="inline-flex items-center justify-center rounded-full border-2 px-7 py-3 text-base font-bold transition-colors"
        style={{ color: onDark ? C.cream : C.ink, borderColor: onDark ? "rgba(246,239,226,0.35)" : "rgb(var(--l-ink-rgb) / 0.25)" }}
      >
        See how it works
      </a>
    </div>
  );
}
