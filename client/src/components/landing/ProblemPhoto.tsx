"use client";

import { useRef } from "react";
import Image from "next/image";
import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { C } from "./palette";
import { FadeUp, WordReveal } from "./Reveal";

// Right after the hero: the other side of the story. The photo of a teacher buried in papers, with the problem in words.

export function ProblemPhoto() {
  const reduceMotion = useReducedMotion();
  const photoRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: photoRef, offset: ["start end", "end start"] });
  const photoY = useTransform(scrollYProgress, [0, 1], ["-5%", "5%"]);

  return (
    <section className="px-4 py-24 sm:px-6 md:py-32 lg:px-8">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <div ref={photoRef} className="relative mx-auto w-full max-w-lg lg:max-w-none">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.94, rotate: 3 }}
            whileInView={{ opacity: 1, scale: 1, rotate: 0 }}
            viewport={{ once: true, margin: "0px 0px -80px 0px" }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            className="relative aspect-square overflow-hidden"
            style={{ background: C.paper }}
          >
            <motion.div style={{ y: reduceMotion ? 0 : photoY, scale: 1.1 }} className="absolute inset-0">
              <Image
                src="/Overwhelmed Exam Grader at Work.png"
                alt="A teacher in a shirt and tie, head in his hand, buried under stacks of exam papers he is still marking by hand"
                fill
                sizes="(min-width: 1024px) 560px, 92vw"
                className="object-cover"
              />
            </motion.div>
          </motion.div>
        </div>

        <div>
          <p className="font-mono text-xs font-medium uppercase tracking-[0.14em] sm:text-sm" style={{ color: "var(--l-red)" }}>
            Meanwhile, for most teachers
          </p>
          <h2 className="mt-4 font-display text-4xl leading-tight md:text-5xl">
            <WordReveal text="This is what exam season looks like." accent={["exam"]} />
          </h2>
          <FadeUp delay={0.2}>
            <p className="mt-5 text-lg leading-relaxed md:text-xl" style={{ color: "rgb(var(--l-ink-rgb) / 0.75)" }}>
              Questions written late at night, papers marked by hand, and an answer key you just hope is right. It is slow, it is tiring, and it takes your weekends.
            </p>
          </FadeUp>
        </div>
      </div>
    </section>
  );
}
