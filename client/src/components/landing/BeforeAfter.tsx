"use client";

import Image from "next/image";
import { Check, X } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { C } from "./palette";
import { FadeUp } from "./Reveal";
import { ShatterHeading } from "./ShatterHeading";

// The problem told as two columns: an exam done by hand, and the same exam done with Abhyas.

const WITHOUT = [
  { title: "Write every question yourself", desc: "Hours of drafting and formatting, then more hours checking that the answer key is right." },
  { title: "Print, hand out, collect", desc: "Paper to print, papers to chase, and sheets that go missing." },
  { title: "Mark every paper by hand", desc: "Evenings and weekends with a red pen, writing the same comments again and again." },
  { title: "Add it all up and hope", desc: "One slip in the totals and a student's result is wrong." },
];

const WITH = [
  { title: "Describe the exam", desc: "Class, topic and marks are enough. Abhyas plans it and writes the questions." },
  { title: "Share a join code", desc: "Students sit the exam in their browser. Nothing to print." },
  { title: "Marks appear on their own", desc: "MCQs are marked the moment they submit. Written answers are graded with feedback." },
  { title: "Review and override", desc: "You stay in charge. Change any mark you disagree with." },
];

function Row({ title, desc, good, i }: { title: string; desc: string; good: boolean; i: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.li
      initial={reduceMotion ? false : { opacity: 0, x: good ? 28 : -28 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      transition={{ duration: 2.2, delay: i * 0.35, ease: "easeInOut" }}
      className="flex gap-4"
    >
      <span
        className="mt-1 grid h-8 w-8 shrink-0 place-items-center"
        style={good ? { background: C.orange, color: "#FFFFFF" } : { background: "rgba(217,45,32,0.12)", color: "var(--l-red)" }}
      >
        {good ? <Check className="h-4 w-4" strokeWidth={3} /> : <X className="h-4 w-4" strokeWidth={3} />}
      </span>
      <div>
        <h3 className="font-display text-xl leading-tight sm:text-2xl">{title}</h3>
        <p className="mt-1 leading-relaxed" style={{ color: "rgb(var(--l-ink-rgb) / 0.7)" }}>
          {desc}
        </p>
      </div>
    </motion.li>
  );
}

/** A photo for the top of a column: it fades up as it scrolls into view while the picture inside settles from a slight zoom. */
function Photo({ src, alt }: { src: string; alt: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative mb-9 aspect-[1672/941] overflow-hidden border"
      style={{ background: C.paper, borderColor: "rgb(var(--l-ink-rgb) / 0.14)" }}
    >
      <motion.div
        initial={reduceMotion ? false : { scale: 1.15 }}
        whileInView={{ scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 3, ease: [0.22, 1, 0.36, 1] }}
        className="absolute inset-0"
      >
        <Image src={src} alt={alt} fill sizes="(min-width: 768px) 560px, 92vw" className="object-cover" />
      </motion.div>
    </motion.div>
  );
}

export function BeforeAfter() {
  return (
    <section className="px-4 py-24 sm:px-6 md:py-32 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-3xl text-center">
          <ShatterHeading />
          <FadeUp delay={0.3} duration={1.4}>
            <p className="mt-5 text-lg md:text-xl" style={{ color: "rgb(var(--l-ink-rgb) / 0.72)" }}>
              Writing, running and marking exams eats the time you would rather spend teaching.
            </p>
          </FadeUp>
        </div>

        <div className="mt-16 grid gap-14 md:grid-cols-2 md:gap-0">
          <div className="md:pr-14">
            <Photo
              src="/Stressed Teacher Grading Exams.png"
              alt="A stressed teacher with his hand on his forehead, grading by hand between tall stacks of papers, in front of a blackboard checklist: write questions, print and distribute, collect answers, check and evaluate, make reports"
            />
            <FadeUp duration={2}>
              <p className="mb-8 font-mono text-xs font-medium uppercase tracking-[0.14em] sm:text-sm" style={{ color: "var(--l-red)" }}>
                Doing it by hand
              </p>
            </FadeUp>
            <ul className="space-y-8">
              {WITHOUT.map((r, i) => (
                <Row key={r.title} {...r} good={false} i={i} />
              ))}
            </ul>
          </div>

          <div className="relative md:border-l md:pl-14" style={{ borderColor: "rgb(var(--l-ink-rgb) / 0.15)" }}>
            <Photo
              src="/AI Exam Platform Banner with Laptop and Student.png"
              alt="A smiling teacher at her laptop running Abhyas, with a checklist: generate exams with AI, conduct online exams, auto evaluation, reports and analytics, and a card saying the exam is completed"
            />
            <FadeUp duration={2}>
              <p className="mb-8 font-mono text-xs font-medium uppercase tracking-[0.14em] sm:text-sm" style={{ color: C.orange }}>
                With Abhyas
              </p>
            </FadeUp>
            <ul className="space-y-8">
              {WITH.map((r, i) => (
                <Row key={r.title} {...r} good i={i} />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
