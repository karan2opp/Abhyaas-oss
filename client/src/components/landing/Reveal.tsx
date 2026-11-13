"use client";

import { Fragment, useRef, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { C } from "./palette";

const EASE = [0.22, 1, 0.36, 1] as const;

/** A headline whose words slide up out of a mask one after another when it scrolls into view. */
export function WordReveal({
  text,
  className = "",
  accent = [],
  delay = 0,
}: {
  text: string;
  className?: string;
  /** Words (without punctuation) to colour in the brand orange. */
  accent?: string[];
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();
  // Watch the outer wrapper, not the words: a word sliding up from inside its clipping mask counts as "not on screen".
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -10% 0px" });
  const words = text.split(" ");
  return (
    <span ref={ref} className={className}>
      {words.map((word, i) => {
        const color = accent.includes(word.replace(/[.,!?]/g, "")) ? C.orange : undefined;
        return (
          <Fragment key={i}>
            <span className="-mb-[0.14em] inline-block overflow-hidden pb-[0.14em] align-bottom">
              <motion.span
                className="inline-block"
                style={{ color }}
                initial={reduceMotion ? false : { y: "115%" }}
                animate={{ y: inView || reduceMotion ? "0%" : "115%" }}
                transition={{ duration: 0.7, ease: EASE, delay: delay + i * 0.06 }}
              >
                {word}
              </motion.span>
            </span>{" "}
          </Fragment>
        );
      })}
    </span>
  );
}

/** Fades and lifts its children in when they scroll into view. */
export function FadeUp({ children, className = "", delay = 0, duration = 0.7 }: { children: ReactNode; className?: string; delay?: number; duration?: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      transition={{ duration, ease: EASE, delay }}
    >
      {children}
    </motion.div>
  );
}
