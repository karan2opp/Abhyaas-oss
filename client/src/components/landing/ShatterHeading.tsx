"use client";

import { Fragment, useEffect, useRef, useState, type Ref } from "react";
import { motion, useInView, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from "framer-motion";
import { C } from "./palette";

// "Exam season is BROKEN for every teacher." as a pane of glass. When it scrolls into view the pane takes a hit on the word
// BROKEN: a flash and a shake, cracks run out from that spot, and then the heading falls apart into shards that drift a few
// pixels apart, like a cracked mirror. Each shard is a copy of the same heading cut to a jagged shape. On a desktop the shards
// slide a little as the mouse moves, so the glass seems to catch the light.
//
// The real heading (the one a screen reader reads) is the whole pane. The shard copies are hidden from assistive tech.

type Pt = readonly [number, number];
interface Shard {
  clip: string;
  origin: string;
  dx: number;
  dy: number;
  rot: number;
  depth: number;
  tint: string;
}
interface Geo {
  w: number;
  h: number;
  p: Pt;
  shards: Shard[];
  rays: Pt[];
  rings: [Pt, Pt][];
}

/** A small seeded random number generator, so the cracks are the same on every visit. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/** Works out the cracks and the shards for a pane of w x h pixels that was hit at p. */
function buildGeo(w: number, h: number, p: Pt, count: number): Geo {
  const rand = rng(11);
  const [px, py] = p;
  const start = rand() * TAU;
  const angles = Array.from({ length: count }, (_, i) => norm(start + (i + (rand() - 0.5) * 0.55) * (TAU / count))).sort((a, b) => a - b);

  // each crack is a jagged line from the hit point out to the edge of the pane
  const rays: Pt[][] = angles.map((a) => {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const ts = [dx > 0 ? (w - px) / dx : dx < 0 ? -px / dx : Infinity, dy > 0 ? (h - py) / dy : dy < 0 ? -py / dy : Infinity];
    const t = Math.min(...ts);
    const edge: Pt = [Math.min(w, Math.max(0, px + dx * t)), Math.min(h, Math.max(0, py + dy * t))];
    const jag = Math.min(26, t * 0.12);
    const mid = [0.25, 0.5, 0.75].map((f): Pt => {
      const ff = f + (rand() - 0.5) * 0.06;
      const off = (rand() - 0.5) * 2 * jag;
      return [px + dx * t * ff - dy * off, py + dy * t * ff + dx * off];
    });
    return [p, ...mid, edge];
  });

  const corners: Pt[] = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
  const cornerAngle = (c: Pt) => norm(Math.atan2(c[1] - py, c[0] - px));

  const shards: Shard[] = angles.map((a0, i) => {
    const wrap = i === count - 1;
    const a1 = wrap ? angles[0] + TAU : angles[i + 1];
    const between = corners
      .map((c) => ({ c, a: cornerAngle(c) < a0 ? cornerAngle(c) + TAU : cornerAngle(c) }))
      .filter(({ a }) => a > a0 && a < a1)
      .sort((x, y) => x.a - y.a)
      .map(({ c }) => c);
    const next = rays[(i + 1) % count];
    const pts: Pt[] = [...rays[i], ...between, ...[...next].reverse().slice(0, -1)];
    const cx = pts.reduce((s, q) => s + q[0], 0) / pts.length;
    const cy = pts.reduce((s, q) => s + q[1], 0) / pts.length;
    const len = Math.hypot(cx - px, cy - py) || 1;
    const mag = 3.5 + rand() * 3.5;
    return {
      clip: `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(", ")})`,
      origin: `${cx.toFixed(1)}px ${cy.toFixed(1)}px`,
      dx: ((cx - px) / len) * mag,
      dy: ((cy - py) / len) * mag,
      rot: (rand() - 0.5) * 2.4,
      depth: 0.4 + rand(),
      tint: `linear-gradient(${Math.round(rand() * 360)}deg, var(--l-glass-a), color-mix(in srgb, var(--l-glass-b) ${Math.round(30 + rand() * 70)}%, var(--l-glass-a)))`,
    };
  });

  // a web of short cracks joining neighbouring cracks, so it looks like glass and not a pie chart
  const rings: [Pt, Pt][] = [];
  for (const k of [1, 2]) {
    for (let i = 0; i < count; i++) {
      if (k === 2 && i % 2 === 1) continue;
      rings.push([rays[i][k], rays[(i + 1) % count][k]]);
    }
  }

  return { w, h, p, shards, rays: rays.flat(), rings };
}

const glassBorder = { border: "1px solid rgb(var(--l-ink-rgb) / 0.1)", borderRadius: "1.5rem" } as const;

/** The heading text, identical in every layer so that every copy wraps the same way. */
function Face({ brokenRef }: { brokenRef?: Ref<HTMLSpanElement> }) {
  return (
    <span className="block px-6 py-10 text-center font-display text-4xl leading-tight md:px-12 md:py-14 md:text-6xl">
      Exam season is{" "}
      <span ref={brokenRef} style={{ color: C.orange }}>
        BROKEN
      </span>{" "}
      for every teacher.
    </span>
  );
}

function ShardView({ shard, broken, still, sx, sy }: { shard: Shard; broken: boolean; still: boolean; sx: MotionValue<number>; sy: MotionValue<number> }) {
  const px = useTransform(sx, [-1, 1], [-shard.depth * 6, shard.depth * 6]);
  const py = useTransform(sy, [-1, 1], [-shard.depth * 4, shard.depth * 4]);
  return (
    <motion.div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ clipPath: shard.clip, transformOrigin: shard.origin }}
      initial={false}
      animate={broken ? { opacity: 1, x: shard.dx, y: shard.dy, rotate: shard.rot } : { opacity: 0, x: 0, y: 0, rotate: 0 }}
      transition={still ? { duration: 0 } : { opacity: { duration: 0 }, default: { type: "spring", stiffness: 170, damping: 13 } }}
    >
      <motion.div className="absolute inset-0" style={{ x: still ? 0 : px, y: still ? 0 : py, background: shard.tint, ...glassBorder }}>
        <Face />
      </motion.div>
    </motion.div>
  );
}

export function ShatterHeading() {
  const reduceMotion = useReducedMotion();
  const boxRef = useRef<HTMLDivElement>(null);
  const brokenRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(boxRef, { once: true, margin: "0px 0px -25% 0px" });
  const [geo, setGeo] = useState<Geo | null>(null);
  const [phase, setPhase] = useState<"idle" | "hit" | "broken">("idle");

  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const sx = useSpring(mx, { stiffness: 120, damping: 18 });
  const sy = useSpring(my, { stiffness: 120, damping: 18 });

  // Where the pane is and where the word BROKEN sits in it, measured again whenever the pane changes size.
  useEffect(() => {
    const box = boxRef.current;
    const target = brokenRef.current;
    if (!box || !target) return;
    const measure = () => {
      const b = box.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      if (!b.width || !b.height) return;
      setGeo(buildGeo(b.width, b.height, [t.left + t.width / 2 - b.left, t.top + t.height / 2 - b.top], b.width < 640 ? 5 : 7));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, []);

  // The sequence: the heading shows whole, takes a hit, then breaks.
  useEffect(() => {
    if (!inView) return;
    if (reduceMotion) {
      setPhase("broken");
      return;
    }
    const hit = setTimeout(() => setPhase("hit"), 3100);
    const broke = setTimeout(() => setPhase("broken"), 3650);
    return () => {
      clearTimeout(hit);
      clearTimeout(broke);
    };
  }, [inView, reduceMotion]);

  const cracked = phase !== "idle";
  const broken = phase === "broken";

  return (
    <motion.div
      ref={boxRef}
      className="relative mx-auto max-w-4xl"
      animate={phase === "hit" ? { x: [0, -7, 6, -4, 2, 0] } : { x: 0 }}
      transition={{ duration: 0.35 }}
      onPointerMove={(e) => {
        if (reduceMotion || !broken || !boxRef.current) return;
        const r = boxRef.current.getBoundingClientRect();
        mx.set(((e.clientX - r.left) / r.width - 0.5) * 2);
        my.set(((e.clientY - r.top) / r.height - 0.5) * 2);
      }}
      onPointerLeave={() => {
        mx.set(0);
        my.set(0);
      }}
    >
      {/* The whole heading. It is the real one, and it disappears the moment the shards take over. */}
      <motion.h2
        className="relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, var(--l-glass-a), var(--l-glass-b))",
          boxShadow: "0 24px 60px -34px rgb(var(--l-shadow-rgb) / 0.3)",
          ...glassBorder,
        }}
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: broken ? 0 : inView || reduceMotion ? 1 : 0 }}
        transition={broken ? { duration: 0 } : { duration: 0.8 }}
      >
        <Face brokenRef={brokenRef} />
        {/* a bright sweep across the glass as it arrives */}
        {!reduceMotion && (
          <motion.span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 w-1/4"
            style={{ background: "linear-gradient(100deg, transparent, var(--l-sheen), transparent)", left: "-30%" }}
            animate={inView ? { left: ["-30%", "130%"] } : undefined}
            transition={{ duration: 1.2, ease: "easeInOut", delay: 0.2 }}
          />
        )}
      </motion.h2>

      {geo && cracked && (
        <>
          {geo.shards.map((s, i) => (
            <ShardView key={i} shard={s} broken={broken} still={!!reduceMotion} sx={sx} sy={sy} />
          ))}

          {/* the impact: a flash where the glass was hit */}
          {!reduceMotion && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute rounded-full"
              style={{ left: geo.p[0] - 90, top: geo.p[1] - 90, width: 180, height: 180, background: "radial-gradient(circle, rgba(255,255,255,0.95), rgba(255,255,255,0) 68%)" }}
              initial={{ opacity: 0, scale: 0.2 }}
              animate={{ opacity: [0, 1, 0], scale: [0.2, 1.3, 1.6] }}
              transition={{ duration: 0.55, ease: "easeOut" }}
            />
          )}

          {/* the cracks, drawn from the hit point outwards, then the web between them */}
          <svg aria-hidden width={geo.w} height={geo.h} viewBox={`0 0 ${geo.w} ${geo.h}`} className="pointer-events-none absolute left-0 top-0 overflow-visible">
            {geo.shards.map((_, i) => {
              const ray = geo.rays.slice(i * 5, i * 5 + 5);
              const d = ray.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
              return (
                <Fragment key={i}>
                  {[
                    { stroke: "rgb(var(--l-ink-rgb) / 0.4)", width: 1.3, shift: 0 },
                    { stroke: "var(--l-crack-hi)", width: 1, shift: 1 },
                  ].map((s) => (
                    <motion.path
                      key={s.stroke}
                      d={d}
                      fill="none"
                      style={{ stroke: s.stroke }}
                      strokeWidth={s.width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      transform={`translate(${s.shift} ${s.shift})`}
                      initial={reduceMotion ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.45, delay: i * 0.03, ease: "easeOut" }}
                    />
                  ))}
                </Fragment>
              );
            })}
            {geo.rings.map(([a, b], i) => (
              <motion.line
                key={i}
                x1={a[0]}
                y1={a[1]}
                x2={b[0]}
                y2={b[1]}
                style={{ stroke: "rgb(var(--l-ink-rgb) / 0.3)" }}
                strokeWidth={1}
                strokeLinecap="round"
                initial={reduceMotion ? false : { pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.3, delay: 0.3 + i * 0.02 }}
              />
            ))}
          </svg>
        </>
      )}
    </motion.div>
  );
}
