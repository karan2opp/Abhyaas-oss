"use client";

import { motion, useReducedMotion } from "framer-motion";
import { pipelines } from "@/lib/pipelines";
import { C } from "./palette";
import { FadeUp, WordReveal } from "./Reveal";

// The four tools as plain rows divided by thin lines: three ways to get the questions, one engine to mark them.

const GROUPS = [
  { label: "Three ways to build the questions", from: 0, to: 3 },
  { label: "One engine to mark them", from: 3, to: 4 },
];

const NAMES = ["AI Generation", "Past Papers", "Textbook", "Evaluation Engine"];

function Row({ index }: { index: number }) {
  const reduceMotion = useReducedMotion();
  const p = pipelines[index];
  return (
    <motion.li
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="grid items-start gap-x-10 gap-y-3 border-l-2 border-t px-5 py-7 md:grid-cols-[1fr_1.4fr] md:px-8"
      style={{ borderColor: "rgb(var(--l-ink-rgb) / 0.15)", borderLeftColor: C.orange }}
    >
      <div className="flex items-baseline gap-5">
        <span className="font-mono text-xs md:text-sm" style={{ color: C.orange }}>
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3 className="font-display text-2xl leading-tight md:text-[1.7rem]">{NAMES[index]}</h3>
      </div>
      <div>
        <p className="text-base leading-relaxed md:text-lg" style={{ color: "rgb(var(--l-ink-rgb) / 0.8)" }}>
          {p.desc}
        </p>
        <p className="mt-2 text-sm" style={{ color: "rgb(var(--l-ink-rgb) / 0.5)" }}>
          {p.steps.join("  →  ")}
        </p>
      </div>
    </motion.li>
  );
}

export function ToolsList() {
  return (
    <section id="tools" className="scroll-mt-16 px-4 py-24 sm:px-6 md:py-32 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-3xl">
          <h2 className="font-display text-4xl leading-tight md:text-6xl">
            <WordReveal text="Everything an exam needs, in one place." accent={["exam"]} />
          </h2>
          <FadeUp delay={0.2}>
            <p className="mt-5 text-lg md:text-xl" style={{ color: "rgb(var(--l-ink-rgb) / 0.72)" }}>
              Pick where the questions come from. Abhyas takes care of the rest.
            </p>
          </FadeUp>
        </div>

        <div className="mt-14 space-y-12">
          {GROUPS.map((g) => (
            <div key={g.label}>
              <p className="mb-3 font-mono text-xs font-medium uppercase tracking-[0.14em] sm:text-sm" style={{ color: "rgb(var(--l-ink-rgb) / 0.55)" }}>
                {g.label}
              </p>
              <ul className="border-b" style={{ borderColor: "rgb(var(--l-ink-rgb) / 0.15)" }}>
                {Array.from({ length: g.to - g.from }, (_, k) => (
                  <Row key={g.from + k} index={g.from + k} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
