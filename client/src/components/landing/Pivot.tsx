"use client";

import { Fragment, useRef } from "react";
import { ArrowDown } from "lucide-react";
import { motion, useReducedMotion, useScroll, useTransform, type MotionValue } from "framer-motion";
import { C } from "./palette";
import { FadeUp } from "./Reveal";

const TEXT = "What if you only had to describe the exam, and Abhyas did the rest?";
const ACCENT = ["describe", "Abhyas"];

function PivotWord({ word, i, total, progress, still }: { word: string; i: number; total: number; progress: MotionValue<number>; still: boolean }) {
  const opacity = useTransform(progress, [i / total, (i + 1) / total], [0.14, 1]);
  const accent = ACCENT.includes(word.replace(/[.,!?]/g, ""));
  return (
    <Fragment>
      <motion.span style={{ opacity: still ? 1 : opacity, color: accent ? C.orange : undefined }} className="inline-block">
        {word}
      </motion.span>{" "}
    </Fragment>
  );
}

/** The turning point of the story: the question lights up word by word as you scroll through it. */
export function Pivot() {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 0.85", "end 0.45"] });
  const words = TEXT.split(" ");

  return (
    <section className="px-4 py-24 sm:px-6 md:py-40 lg:px-8">
      <div ref={ref} className="mx-auto max-w-5xl text-center">
        <p className="font-display text-3xl leading-[1.15] sm:text-5xl md:text-6xl">
          {words.map((w, i) => (
            <PivotWord key={i} word={w} i={i} total={words.length} progress={scrollYProgress} still={!!reduceMotion} />
          ))}
        </p>
        <FadeUp delay={0.1}>
          <p className="mx-auto mt-8 max-w-2xl text-lg md:text-xl" style={{ color: "rgb(var(--l-ink-rgb) / 0.72)" }}>
            Abhyas writes the questions, runs the exam and marks the answers.
          </p>
          <a href="#how-it-works" className="mt-6 inline-flex items-center gap-2 text-sm font-bold" style={{ color: C.orange }}>
            See how it works <ArrowDown className="h-4 w-4" />
          </a>
        </FadeUp>
      </div>
    </section>
  );
}
