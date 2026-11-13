"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { C } from "./palette";
import { WordReveal } from "./Reveal";
import { CtaButtons } from "./Cta";
import { HERO_PATHS, HERO_VIEWBOX } from "./heroPaths";

// The opening: a centred headline, and under it the illustration of a teacher making an exam with Abhyas. The picture has
// a white background, so it is multiplied into the cream page (white turns cream) and its edges are faded out. On top of it
// sit a few live touches placed by percentage, so they stay lined up with the picture at any width: a glow on the AI
// button, a pulse on "Generate Exam", and sparks that ride along the picture's curves: from the three source cards (notes,
// textbook, past papers) into the teacher, and from the "Generate Exam" button through the AI icon to the "Exam Ready" card.
// It also drifts slowly as you scroll.

// Where each source card sits (its centre), as percentages of the picture: [left, top]. Each card glows in turn.
const SOURCES = [
  { card: [16.2, 28], delay: 0 },
  { card: [14.8, 39], delay: 0.5 },
  { card: [13.9, 50.2], delay: 1 },
] as const;

const LOOP = 3.2;

function SourceGlow({ card, delay }: (typeof SOURCES)[number]) {
  return (
    <motion.span
      className="absolute rounded-[40%]"
      style={{
        left: `${card[0]}%`,
        top: `${card[1]}%`,
        width: "17%",
        height: "9%",
        marginLeft: "-8.5%",
        marginTop: "-4.5%",
        background: "radial-gradient(ellipse, rgba(242,106,27,0.32), rgba(242,106,27,0) 70%)",
      }}
      animate={{ opacity: [0, 1, 0], scale: [0.9, 1.1, 0.9] }}
      transition={{ duration: LOOP, delay, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

type Points = readonly (readonly [number, number])[];

/** A glowing dot that rides along a traced curve (points are in the picture's own coordinates), then waits and goes again. */
function PathSpark({ points, delay, duration, repeatDelay }: { points: Points; delay: number; duration: number; repeatDelay: number }) {
  const n = points.length;
  // Fade in over the first few points and out over the last few, full brightness in between.
  const fade = Math.min(4, Math.floor(n / 2));
  const opacity = points.map((_, i) => (i < fade ? i / fade : i >= n - fade ? (n - 1 - i) / fade : 1));
  const cx = points.map(([x]) => x);
  const cy = points.map(([, y]) => y);
  const transition = { duration, delay, repeat: Infinity, repeatDelay, ease: "linear" as const };
  return (
    <>
      <motion.circle r={15} fill={C.orange} fillOpacity={0.28} animate={{ cx, cy, opacity }} transition={transition} />
      <motion.circle r={6.5} fill={C.orange} style={{ filter: `drop-shadow(0 0 6px ${C.orange})` }} animate={{ cx, cy, opacity }} transition={transition} />
    </>
  );
}

export function HeroSection() {
  const reduceMotion = useReducedMotion();
  const sceneRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: sceneRef, offset: ["start end", "end start"] });
  const drift = useTransform(scrollYProgress, [0, 1], ["2.5%", "-2.5%"]);
  const y = reduceMotion ? 0 : drift;

  return (
    <section
      className="relative overflow-x-clip pt-[76px]"
      style={{ backgroundColor: C.cream, backgroundImage: "radial-gradient(rgb(var(--l-ink-rgb) / 0.09) 1px, transparent 1px)", backgroundSize: "22px 22px", backgroundPosition: "top" }}
    >
      <div className="mx-auto max-w-6xl px-4 text-center sm:px-6 lg:px-8">
        <h1 className="font-display text-[2.4rem] leading-[1.04] sm:text-5xl lg:text-6xl">
          <WordReveal text="Conduct exams in minutes." accent={["minutes"]} delay={0.1} />
        </h1>
      </div>

      {/* The whole picture, as wide as the window height allows so that headline, picture and buttons fit on one screen. The
          blank strip at the picture's top is cropped off (the frame is a little shorter than the picture, which sits at its
          bottom). The frame has its own solid cream backdrop, so the page's dots stop at the picture and don't show through the
          cards, and the picture is multiplied onto that backdrop (its white turns cream). The frame's edges fade out into the
          dotted page. */}
      <div
        ref={sceneRef}
        className="landing-hero-frame relative mx-auto mt-1 overflow-hidden"
        style={{
          width: "min(100%, max(480px, calc((100svh - 230px) * 2.02)))",
          aspectRatio: "1730 / 854",
          background: "var(--l-hero-panel)",
        }}
      >
        <div className="absolute inset-x-0 bottom-0" style={{ aspectRatio: "1730 / 909" }}>
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5, duration: 1, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
            style={{ y, mixBlendMode: "multiply" }}
          >
            <Image
              src="/abhyas-hero-illustration.png"
              alt="A teacher smiling at his laptop while Abhyas builds an exam: ideas, a textbook or notes, and past papers go in, and a question paper, answer key and auto evaluation come out, ready to publish in about 5 minutes"
              fill
              priority
              sizes="100vw"
              className="object-contain"
            />
          </motion.div>

          {!reduceMotion && (
            <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ y }}>
              {/* A soft glow that breathes behind the AI button in the middle of the picture. */}
              <motion.div
                className="absolute rounded-full"
                style={{
                  left: "60.1%",
                  top: "58.3%",
                  width: "14%",
                  aspectRatio: "1",
                  marginLeft: "-7%",
                  marginTop: "-7%",
                  background: "radial-gradient(circle, rgba(242,106,27,0.4), rgba(242,106,27,0) 68%)",
                }}
                animate={{ scale: [0.8, 1.2, 0.8], opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
              />
              {/* A ring that pulses out of the "Generate Exam" button, as if it were just clicked. */}
              <motion.div
                className="absolute rounded-full border-2"
                style={{ left: "48.8%", top: "41.4%", width: "23.6%", height: "5.9%", borderColor: C.orange }}
                animate={{ scale: [1, 1.12], opacity: [0.75, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: "easeOut" }}
              />
              {/* A light sweep across the "Generate Exam" button. */}
              <div className="absolute overflow-hidden rounded-full" style={{ left: "48.8%", top: "41.4%", width: "23.6%", height: "5.9%" }}>
                <motion.div
                  className="absolute inset-y-0 w-1/4"
                  style={{ background: "linear-gradient(100deg, transparent, rgba(150,50,0,0.35), transparent)" }}
                  animate={{ left: ["-30%", "120%"] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut", repeatDelay: 0.6 }}
                />
              </div>
              {SOURCES.map((s, i) => (
                <SourceGlow key={i} {...s} />
              ))}
              {/* The sparks: one down each of the three source curves, one from the button down to the AI icon, and one from the
                  icon out along the curve to the "Exam Ready" card. They share one drawing area that matches the picture. */}
              <svg viewBox={HERO_VIEWBOX} className="absolute inset-0 h-full w-full overflow-visible">
                <PathSpark points={HERO_PATHS.notes} delay={0.2} duration={1.5} repeatDelay={LOOP - 1.5} />
                <PathSpark points={HERO_PATHS.textbook} delay={0.7} duration={1.5} repeatDelay={LOOP - 1.5} />
                <PathSpark points={HERO_PATHS.past} delay={1.2} duration={1.5} repeatDelay={LOOP - 1.5} />
                <PathSpark points={HERO_PATHS.drop} delay={0} duration={0.6} repeatDelay={LOOP - 0.6} />
                <PathSpark points={HERO_PATHS.right} delay={0.6} duration={1.6} repeatDelay={LOOP - 1.6} />
              </svg>
              {/* Where the three curves meet, a little pulse as the sources arrive. */}
              <motion.span
                className="absolute rounded-full"
                style={{ left: "30.1%", top: "48.4%", width: "3.2%", aspectRatio: "1", marginLeft: "-1.6%", marginTop: "-1.6%", background: "radial-gradient(circle, rgba(242,106,27,0.6), rgba(242,106,27,0) 70%)" }}
                animate={{ scale: [0.6, 1.5, 0.6], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: LOOP / 2, repeat: Infinity, ease: "easeInOut" }}
              />
            </motion.div>
          )}
        </div>
      </div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        className="relative flex justify-center px-4 pb-4 pt-3"
      >
        <CtaButtons />
      </motion.div>
    </section>
  );
}
