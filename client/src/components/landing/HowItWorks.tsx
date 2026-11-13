"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from "framer-motion";
import { C } from "./palette";
import { FadeUp, WordReveal } from "./Reveal";
import { MockBuild, MockResults, MockShare } from "./Mocks";

const STEPS = [
  {
    title: "Describe your exam",
    desc: "Type the subject, the class, the topics and the marks. Abhyas plans it, writes every question and checks each MCQ's answer before saving. Want a change? Just chat: \"make question 4 harder\".",
    Mock: MockBuild,
  },
  {
    title: "Share a join code",
    desc: "Publish the exam and give your students the code. They join and sit it in their browser. No printing, no collecting papers.",
    Mock: MockShare,
  },
  {
    title: "Marks, instantly",
    desc: "MCQs are marked the moment a student submits. Written answers are graded by AI with feedback, and you can review and override any mark.",
    Mock: MockResults,
  },
];

function Heading() {
  return (
    <div>
      <h2 className="font-display text-4xl leading-tight md:text-6xl">
        <WordReveal text="Three steps. No weekends lost." accent={["weekends"]} />
      </h2>
    </div>
  );
}

/** Desktop: the section holds still while you scroll, and the screen on the right changes with each step. */
function Pinned() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length)))));
  const Mock = STEPS[active].Mock;

  return (
    <div ref={ref} className="relative hidden lg:block" style={{ height: "300vh" }}>
      <div className="sticky top-0 flex h-screen items-center px-8">
        <div className="mx-auto grid w-full max-w-7xl grid-cols-[1fr_1.1fr] items-center gap-16 px-10 pt-16 xl:px-14">
          <div>
            <Heading />
            <ol className="mt-10 space-y-3">
              {STEPS.map((s, i) => {
                const on = i === active;
                return (
                  <li key={s.title}>
                    <button
                      type="button"
                      onClick={() => {
                        const el = ref.current;
                        if (!el) return;
                        const span = el.offsetHeight - window.innerHeight;
                        window.scrollTo({ top: el.offsetTop + ((i + 0.5) / STEPS.length) * span, behavior: "smooth" });
                      }}
                      className="flex w-full gap-5 border border-l-2 p-4 text-left transition-colors"
                      style={{
                        background: on ? "var(--l-surface)" : "transparent",
                        borderColor: on ? "rgb(var(--l-ink-rgb) / 0.14)" : "transparent",
                        borderLeftColor: on ? C.orange : "transparent",
                        opacity: on ? 1 : 0.45,
                      }}
                    >
                      <span
                        className="grid h-10 w-10 shrink-0 place-items-center font-mono text-sm font-semibold transition-colors"
                        style={{ background: on ? C.orange : "rgb(var(--l-ink-rgb) / 0.1)", color: on ? "#FFFFFF" : C.ink }}
                      >
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <span className="block font-display text-2xl leading-tight">{s.title}</span>
                        <AnimatePresence initial={false}>
                          {on && (
                            <motion.span
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.35 }}
                              className="block overflow-hidden"
                            >
                              <span className="mt-2 block leading-relaxed" style={{ color: "rgb(var(--l-ink-rgb) / 0.75)" }}>
                                {s.desc}
                              </span>
                            </motion.span>
                          )}
                        </AnimatePresence>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 30, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.98 }}
                transition={{ duration: 0.35 }}
                className="relative"
              >
                <Mock />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Phones, tablets and anyone who asked for less motion: the three steps one under the other. */
function Stacked({ className }: { className: string }) {
  return (
    <div className={`px-4 py-20 sm:px-6 ${className}`}>
      <div className="mx-auto max-w-2xl">
        <Heading />
        <div className="mt-12 space-y-16">
          {STEPS.map((s, i) => (
            <FadeUp key={s.title}>
              <div className="flex items-center gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center font-mono text-sm font-semibold text-white" style={{ background: C.orange }}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="font-display text-2xl leading-tight">{s.title}</h3>
              </div>
              <p className="mt-3 leading-relaxed" style={{ color: "rgb(var(--l-ink-rgb) / 0.75)" }}>
                {s.desc}
              </p>
              <div className="mt-6">
                <s.Mock />
              </div>
            </FadeUp>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HowItWorks() {
  const reduceMotion = useReducedMotion();
  return (
    <div id="how-it-works" className="scroll-mt-16">
      {!reduceMotion && <Pinned />}
      <Stacked className={reduceMotion ? "" : "lg:hidden"} />
    </div>
  );
}
