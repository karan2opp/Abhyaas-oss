"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useReducedMotion } from "framer-motion";
import { Check } from "lucide-react";
import { C } from "./palette";

// Small look-alike Abhyas screens for the "how it works" story. They are drawn with plain page elements (not pictures) and
// play their little animation when they scroll into view. The names and numbers in them are sample data.

/** Types its text out one letter at a time once it is on screen. The full text's space is kept so nothing jumps. */
function Typed({ text, delay = 0 }: { text: string; delay?: number }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      let n = 0;
      timer = setInterval(() => {
        n += 1;
        setCount(n);
        if (n >= text.length) clearInterval(timer);
      }, 26);
    }, delay * 1000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
    };
  }, [inView, reduceMotion, text, delay]);

  const shown = reduceMotion ? text.length : count;
  return (
    <span ref={ref}>
      {text.slice(0, shown)}
      <span className="opacity-0">{text.slice(shown)}</span>
    </span>
  );
}

/** Counts up to a number once it is on screen. */
function Counter({ to, delay = 0, suffix = "" }: { to: number; delay?: number; suffix?: string }) {
  const reduceMotion = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView || reduceMotion) return;
    const controls = animate(0, to, { duration: 1.4, delay, ease: "easeOut", onUpdate: (v) => setValue(Math.round(v)) });
    return () => controls.stop();
  }, [inView, reduceMotion, to, delay]);

  return (
    <span ref={ref}>
      {reduceMotion ? to : value}
      {suffix}
    </span>
  );
}

function Appear({ children, delay, className = "" }: { children: ReactNode; delay: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** A browser-like frame around a mock screen. */
export function MockWindow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden border border-l-2 text-left" style={{ background: "var(--l-surface)", borderColor: "rgb(var(--l-ink-rgb) / 0.14)", borderLeftColor: C.orange }}>
      <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: "rgb(var(--l-ink-rgb) / 0.08)", background: C.paper }}>
        <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
        <span className="ml-3 text-xs font-semibold" style={{ color: "rgb(var(--l-ink-rgb) / 0.55)" }}>
          {title}
        </span>
      </div>
      <div className="p-5 sm:p-6">{children}</div>
      <p className="border-t px-5 py-2 text-[11px]" style={{ borderColor: "rgb(var(--l-ink-rgb) / 0.08)", color: "rgb(var(--l-ink-rgb) / 0.45)" }}>
        Sample data
      </p>
    </div>
  );
}

const FIELDS = [
  ["Subject", "Physics"],
  ["Topics", "Optics, Modern Physics"],
  ["Questions", "20 MCQ + 5 written"],
  ["Total marks", "40"],
];

const QUESTIONS = [
  "A convex lens has a focal length of 20 cm. Where must an object be placed to get a real image of the same size?",
  "State two differences between interference and diffraction of light.",
  "What is the threshold frequency in the photoelectric effect?",
];

/** Step 1: a few inputs go in, a checked set of questions comes out. */
export function MockBuild() {
  return (
    <MockWindow title="New exam">
      <div className="grid gap-2.5">
        {FIELDS.map(([label, value], i) => (
          <div key={label} className="flex items-center justify-between gap-4 border px-3.5 py-2.5 text-sm" style={{ borderColor: "rgb(var(--l-ink-rgb) / 0.12)" }}>
            <span style={{ color: "rgb(var(--l-ink-rgb) / 0.55)" }}>{label}</span>
            <span className="font-semibold">
              <Typed text={value} delay={0.2 + i * 0.5} />
            </span>
          </div>
        ))}
      </div>
      <Appear delay={2.3} className="mt-4">
        <div className="inline-flex px-5 py-2 text-sm font-bold text-white" style={{ background: C.orange }}>
          Generate exam
        </div>
      </Appear>
      <div className="mt-4 space-y-2.5">
        {QUESTIONS.map((q, i) => (
          <Appear key={q} delay={2.8 + i * 0.35}>
            <div className="border p-3 text-sm" style={{ background: C.paper, borderColor: "rgb(var(--l-ink-rgb) / 0.1)" }}>
              <p className="leading-snug">
                <span className="mr-1.5 font-bold" style={{ color: C.orange }}>
                  Q{i + 1}.
                </span>
                {q}
              </p>
              <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold" style={{ color: "var(--l-green)" }}>
                <Check className="h-3 w-3" strokeWidth={3} /> Answer verified
              </p>
            </div>
          </Appear>
        ))}
      </div>
    </MockWindow>
  );
}

const JOINERS = ["Aarav S.", "Diya M.", "Kabir R.", "Meera P."];

/** Step 2: a join code goes out and students arrive. */
export function MockShare() {
  return (
    <MockWindow title="Physics Unit Test · Published">
      <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: "rgb(var(--l-ink-rgb) / 0.55)" }}>
        Join code
      </p>
      <Appear delay={0.1}>
        <p className="mt-2 font-mono text-5xl font-semibold tracking-[0.12em] sm:text-6xl" style={{ color: C.orange }}>
          K7M·29X
        </p>
      </Appear>
      <div className="mt-6 flex items-baseline gap-2">
        <span className="font-display text-4xl">
          <Counter to={42} delay={0.5} />
        </span>
        <span className="text-sm" style={{ color: "rgb(var(--l-ink-rgb) / 0.6)" }}>
          students joined
        </span>
      </div>
      <div className="mt-4 space-y-2">
        {JOINERS.map((name, i) => (
          <Appear key={name} delay={0.7 + i * 0.4}>
            <div className="flex items-center gap-3 border px-3 py-2 text-sm" style={{ background: C.paper, borderColor: "rgb(var(--l-ink-rgb) / 0.1)" }}>
              <span className="grid h-7 w-7 place-items-center text-xs font-bold text-white" style={{ background: [C.orange, C.blue, C.pink, "#14B8A6"][i] }}>
                {name[0]}
              </span>
              <span className="font-semibold">{name}</span>
              <span className="ml-auto text-xs" style={{ color: "rgb(var(--l-ink-rgb) / 0.5)" }}>
                joined
              </span>
            </div>
          </Appear>
        ))}
      </div>
    </MockWindow>
  );
}

const RESULTS = [
  { name: "Aarav S.", marks: 36, note: "MCQ + written" },
  { name: "Diya M.", marks: 33, note: "MCQ + written" },
  { name: "Kabir R.", marks: 29, note: "MCQ + written" },
  { name: "Meera P.", marks: 38, note: "MCQ + written" },
];

/** Step 3: the marks fill in by themselves. */
export function MockResults() {
  const reduceMotion = useReducedMotion();
  return (
    <MockWindow title="Physics Unit Test · Results">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: "rgb(var(--l-ink-rgb) / 0.55)" }}>
            Class average
          </p>
          <p className="font-display text-5xl">
            <Counter to={34} delay={0.3} />
            <span className="text-2xl" style={{ color: "rgb(var(--l-ink-rgb) / 0.45)" }}>
              /40
            </span>
          </p>
        </div>
        <span className="px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.1em]" style={{ background: C.lime, color: "#1B1410" }}>
          Marked in seconds
        </span>
      </div>
      <div className="mt-5 space-y-3">
        {RESULTS.map((r, i) => (
          <div key={r.name}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{r.name}</span>
              <span className="font-bold">{r.marks}/40</span>
            </div>
            <div className="mt-1.5 h-2.5 overflow-hidden" style={{ background: C.paper }}>
              <motion.div
                initial={reduceMotion ? false : { width: 0 }}
                whileInView={{ width: `${(r.marks / 40) * 100}%` }}
                viewport={{ once: true }}
                transition={{ delay: 0.4 + i * 0.2, duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                className="h-full"
                style={{ background: C.orange }}
              />
            </div>
            <p className="mt-1 text-[11px]" style={{ color: "rgb(var(--l-ink-rgb) / 0.5)" }}>
              {r.note}
            </p>
          </div>
        ))}
      </div>
    </MockWindow>
  );
}
