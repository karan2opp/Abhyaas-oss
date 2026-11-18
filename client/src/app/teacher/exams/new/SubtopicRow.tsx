"use client";

import React from "react";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const stepButton = "flex h-9 w-9 items-center justify-center rounded-md transition-colors disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * One subtopic of a past paper with how many questions are picked from it, how many more it can give, and a stepper.
 * Used by the past-paper build step and by the "Choose topics" picker of an exam made from past papers. `inExam`: how
 * many of its questions are already in the exam (the picker only), shown so the teacher sees why fewer are left.
 */
export function SubtopicRow({ name, count, remaining, inExam = 0, onCount }: { name: string; count: number; remaining: number; inExam?: number; onCount: (n: number) => void }) {
  const noneLeft = count === 0 && remaining === 0;
  let hint = count > 0 ? `${remaining} more available` : remaining > 0 ? `${remaining} available` : inExam > 0 ? "All already in the exam" : "All used by your other picks";
  if (inExam > 0 && !noneLeft) hint += ` · ${inExam} already in the exam`;
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <p className={cn("text-[13px]", count > 0 ? "font-semibold text-orange-200" : "font-medium text-gray-100")}>{name}</p>
        <p className={cn("text-[11px]", noneLeft ? "text-amber-400" : count > 0 ? "text-orange-300/80" : "text-gray-400")}>{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label={`Fewer questions from ${name}`}
          disabled={count <= 0}
          onClick={() => onCount(count - 1)}
          className={cn(stepButton, "text-gray-200 hover:bg-white/10 hover:text-white")}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className={cn("w-7 text-center text-sm font-bold tabular-nums", count > 0 ? "text-orange-300" : "text-gray-300")}>{count}</span>
        <button
          type="button"
          aria-label={`More questions from ${name}`}
          disabled={remaining <= 0}
          onClick={() => onCount(count + 1)}
          className={cn(stepButton, "text-orange-400 hover:bg-orange-500/15 hover:text-orange-300")}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
