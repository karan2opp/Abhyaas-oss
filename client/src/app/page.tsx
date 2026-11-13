import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { C } from "@/components/landing/palette";
import { LandingThemeToggle } from "@/components/landing/LandingThemeToggle";
import { SmoothAnchors } from "@/components/landing/SmoothAnchors";
import { HeroSection } from "@/components/landing/HeroSection";
import { ProblemPhoto } from "@/components/landing/ProblemPhoto";
import { BeforeAfter } from "@/components/landing/BeforeAfter";
import { Pivot } from "@/components/landing/Pivot";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { ToolsList } from "@/components/landing/ToolsList";
import { CtaBand } from "@/components/landing/CtaBand";

// The landing page tells one story: exam season by hand is exhausting, what if you only had to describe the exam, here is
// how Abhyas does it. Near-white with the brand orange, and a dark theme behind the sun/moon button in the nav. The colours are
// theme variables (see globals.css) that follow the app's own theme.

const FIRST_VISIT_LIGHT = `try{if(!localStorage.getItem("theme")){localStorage.setItem("theme","light");document.documentElement.classList.remove("dark");document.documentElement.style.colorScheme="light";}}catch(e){}`;

const navLink = "rounded-full px-3 py-2 text-sm font-semibold transition-colors hover:bg-[rgb(var(--l-ink-rgb)/0.07)]";

const RULE = "rgb(var(--l-ink-rgb) / 0.12)";

/** A thin line across the full width of the page, dividing two sections. */
function Rule() {
  return <div aria-hidden className="h-px w-full" style={{ background: RULE }} />;
}

export default function LandingPage() {
  return (
    <div className="landing relative min-h-screen font-sans" style={{ background: C.cream, color: C.ink }}>
      {/* A first-time visitor (no saved theme yet) starts on the light page, whatever their device uses. This runs while the page
          is being read, before anything is painted, so a dark device never flashes dark first. */}
      <script dangerouslySetInnerHTML={{ __html: FIRST_VISIT_LIGHT }} />
      {/* The two thin vertical lines down the whole page, lined up with the ones in the nav. They sit behind anything positioned
          on top of them, such as the hero picture. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-0 w-full max-w-7xl -translate-x-1/2 border-x" style={{ borderColor: RULE }} />
      <nav className="fixed top-0 z-50 w-full backdrop-blur-md" style={{ background: "var(--l-nav-bg)", borderBottom: "1px solid rgb(var(--l-ink-rgb) / 0.08)" }}>
        {/* The two thin vertical lines on either side of the nav's content, like a ruled page. */}
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between border-x px-4 sm:px-6 lg:px-8" style={{ borderColor: "rgb(var(--l-ink-rgb) / 0.12)" }}>
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/abhyas-logo.png" alt="Abhyas" className="h-8 w-8 shrink-0 object-contain" />
            <span className="font-display text-2xl tracking-tight">Abhyas</span>
          </Link>
          <div className="hidden items-center gap-1 md:flex">
            <a href="#how-it-works" className={navLink}>
              How it works
            </a>
            <a href="#tools" className={navLink}>
              Tools
            </a>
            <a href="https://github.com/karan2opp/AbhyasLM" target="_blank" rel="noreferrer" className={navLink}>
              Contact
            </a>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <LandingThemeToggle />
            <SmoothAnchors />
            <Link href="/auth/login" className={`${navLink} hidden sm:block`}>
              Log in
            </Link>
            <Link
              href="/auth/login"
              className="inline-flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-bold text-white transition-transform hover:-translate-y-0.5"
              style={{ background: C.orange }}
            >
              Get Started <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </nav>

      <HeroSection />
      <Rule />
      <ProblemPhoto />
      <Rule />
      <BeforeAfter />
      <Rule />
      <Pivot />
      <Rule />
      <HowItWorks />
      <Rule />
      <ToolsList />
      <Rule />
      <CtaBand />

      <footer className="px-4 py-8" style={{ borderTop: "1px solid rgb(var(--l-ink-rgb) / 0.12)" }}>
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-6 text-sm md:flex-row lg:px-10" style={{ color: "rgb(var(--l-ink-rgb) / 0.7)" }}>
          <div className="flex items-center gap-2">
            <img src="/abhyas-logo.png" alt="Abhyas" className="h-5 w-5 object-contain" />
            <span className="font-display" style={{ color: C.ink }}>
              Abhyas
            </span>
          </div>
          <div className="flex items-center gap-5 font-semibold">
            <Link href="/auth/login" className="hover:underline">
              Log in
            </Link>
            <a href="https://github.com/karan2opp/AbhyasLM" target="_blank" rel="noreferrer" className="hover:underline">
              Contact
            </a>
          </div>
          <p>Made with ❤️ by Karan</p>
        </div>
      </footer>
    </div>
  );
}
