"use client";

import Link from "next/link";
import { ArrowRight, CheckCheck } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { C } from "./palette";
import { FadeUp } from "./Reveal";

// The closing call to action, drawn as a pixel-art banner: a bold orange panel with stepped (pixel) corners, clouds built from
// squares that drift slowly, a headline with one word in a white pill, a tiny pixel logo and monospace caps lines.

const MONO = 'var(--font-geist-mono), ui-monospace, "SFMono-Regular", Menlo, monospace';

// The panel's corners are cut in steps instead of curves.
const PIXEL_CORNERS =
  "polygon(0 10px, 5px 10px, 5px 5px, 10px 5px, 10px 0, calc(100% - 10px) 0, calc(100% - 10px) 5px, calc(100% - 5px) 5px, calc(100% - 5px) 10px, 100% 10px, 100% calc(100% - 10px), calc(100% - 5px) calc(100% - 10px), calc(100% - 5px) calc(100% - 5px), calc(100% - 10px) calc(100% - 5px), calc(100% - 10px) 100%, 10px 100%, 10px calc(100% - 5px), 5px calc(100% - 5px), 5px calc(100% - 10px), 0 calc(100% - 10px))";

// Clouds drawn as grids of squares: every "#" is one pixel.
const CLOUD_LARGE = [
  "          ####          ",
  "        ########  ##    ",
  "      ##############    ",
  "   ##################   ",
  "########################",
  "########################",
];
const CLOUD_SMALL = ["      ####    ", "   ##########", "##############", "##############"];

function PixelCloud({ rows, unit, className, drift, delay = 0 }: { rows: string[]; unit: number; className: string; drift: number; delay?: number }) {
  const reduceMotion = useReducedMotion();
  const cols = Math.max(...rows.map((r) => r.length));
  return (
    <motion.svg
      aria-hidden
      viewBox={`0 0 ${cols * unit} ${rows.length * unit}`}
      className={`pointer-events-none absolute ${className}`}
      shapeRendering="crispEdges"
      animate={reduceMotion ? undefined : { x: [0, drift, 0] }}
      transition={{ duration: 14, delay, repeat: Infinity, ease: "easeInOut" }}
    >
      {rows.map((row, y) =>
        [...row].map((ch, x) =>
          ch === "#" ? <rect key={`${x}-${y}`} x={x * unit} y={y * unit} width={unit} height={unit} fill="#fff" fillOpacity={y === rows.length - 1 ? 0.13 : 0.2} /> : null,
        ),
      )}
    </motion.svg>
  );
}

export function CtaBand() {
  const reduceMotion = useReducedMotion();
  return (
    <section className="px-4 pb-20 pt-6 sm:px-6 lg:px-8">
      <div
        className="relative mx-auto max-w-6xl overflow-hidden px-6 py-12 text-white md:px-12 md:py-14"
        style={{ clipPath: PIXEL_CORNERS, background: "linear-gradient(180deg, #E2530A 0%, #F26A1B 45%, #FF9A3D 100%)" }}
      >
        <PixelCloud rows={CLOUD_LARGE} unit={12} className="-bottom-1 left-[34%] hidden w-[290px] md:block" drift={22} />
        <PixelCloud rows={CLOUD_SMALL} unit={8} className="right-[9%] top-6 hidden w-[120px] md:block" drift={-16} delay={2} />
        <PixelCloud rows={CLOUD_SMALL} unit={8} className="-bottom-1 right-6 w-[90px] md:hidden" drift={-10} />

        <div className="relative grid gap-10 md:grid-cols-[1.25fr_1fr] md:gap-8">
          <div>
            <h2 className="font-display text-4xl leading-[1.08] sm:text-5xl md:text-6xl">
              Take your{" "}
              <motion.span
                className="inline-block rounded-xl px-3 pb-1"
                style={{ background: "#fff", color: C.orange }}
                initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
                whileInView={{ scale: 1, opacity: 1 }}
                viewport={{ once: true, margin: "0px 0px -15% 0px" }}
                transition={{ type: "spring", stiffness: 220, damping: 14, delay: 0.35 }}
              >
                weekends
              </motion.span>{" "}
              back.
            </h2>

            <FadeUp delay={0.2}>
              <p className="mt-6 flex items-center gap-3 text-xs uppercase tracking-[0.18em] sm:text-sm" style={{ fontFamily: MONO }}>
                <span className="inline-flex shrink-0 gap-1 rounded-[3px] bg-white p-1" aria-hidden>
                  <span className="h-2.5 w-2.5" style={{ background: C.blue }} />
                  <span className="h-2.5 w-2.5" style={{ background: C.yellow }} />
                  <span className="h-2.5 w-2.5" style={{ background: "#E2530A" }} />
                </span>
                Set up your first exam in a few minutes
              </p>
              <p
                className="mt-4 inline-flex items-center gap-2 rounded-lg border border-white/40 bg-white/10 px-3 py-2 text-xs uppercase tracking-[0.12em] sm:text-sm"
                style={{ fontFamily: MONO }}
              >
                <CheckCheck className="h-4 w-4" aria-hidden />
                <b className="font-bold">MCQs marked instantly</b>
                <span className="opacity-90">written answers AI-graded</span>
              </p>
            </FadeUp>
          </div>

          <FadeUp delay={0.35} className="flex flex-col justify-end md:items-end md:text-right">
            <p className="max-w-sm text-base sm:text-lg">Describe the exam, share a join code, and let Abhyas do the marking.</p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row md:justify-end">
              <Link
                href="/auth/login"
                className="group inline-flex items-center justify-center gap-2 rounded-full bg-white px-7 py-3.5 text-base font-bold transition-transform hover:-translate-y-0.5"
                style={{ color: "#D9520A", boxShadow: "0 10px 24px -12px rgba(0,0,0,0.5)" }}
              >
                Get started free <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center rounded-full border-2 border-white/70 px-7 py-3 text-base font-bold transition-colors hover:bg-white/15"
              >
                See how it works
              </a>
            </div>
          </FadeUp>
        </div>
      </div>
    </section>
  );
}
