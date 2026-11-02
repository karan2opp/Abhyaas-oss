"use client";

import React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DateTimeInput } from "@/components/DateTimeInput";

export type AssignmentDetails = {
  title: string;
  instructions: string[];
  startDate: string;
  dueDate: string;
};

export const EMPTY_ASSIGNMENT_DETAILS: AssignmentDetails = {
  title: "",
  instructions: [""],
  startDate: "",
  dueDate: "",
};

const inputClass = "text-white placeholder:text-zinc-500 h-11";
const labelClass = "text-sm font-semibold text-gray-300";

export function AssignmentDetailsForm({
  values,
  onChange,
}: {
  values: AssignmentDetails;
  onChange: (patch: Partial<AssignmentDetails>) => void;
}) {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-bold text-white">Assignment Details</h2>
        <p className="text-xs text-gray-400 mt-0.5">Basic information students will see when completing this assignment.</p>
      </div>

      <div className="space-y-2">
        <label className={labelClass}>Assignment Title</label>
        <Input
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="e.g. Data Structures & Algorithms - Homework 1"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="space-y-2">
          <label className={labelClass}>Unlock Date / Start Date (optional)</label>
          <DateTimeInput
            value={values.startDate}
            onChange={(v) => onChange({ startDate: v })}
           
          />
          <p className="text-xs text-gray-500">Students can open and work on this assignment starting from this time.</p>
        </div>

        <div className="space-y-2">
          <label className={labelClass}>Due Date / Deadline (optional)</label>
          <DateTimeInput
            value={values.dueDate}
            onChange={(v) => onChange({ dueDate: v })}
           
          />
          <p className="text-xs text-gray-500">Students must submit before this deadline. No countdown timer required.</p>
        </div>
      </div>

      <div className="space-y-2">
        <label className={labelClass}>Instructions & Guidance</label>
        <div className="space-y-2.5">
          {values.instructions.map((inst, idx) => (
            <div key={idx} className="flex gap-2">
              <Input
                value={inst}
                onChange={(e) =>
                  onChange({
                    instructions: values.instructions.map((v, i) => (i === idx ? e.target.value : v)),
                  })
                }
                placeholder={`Instruction ${idx + 1}`}
                className={cn(inputClass, "h-10 flex-1")}
              />
              {values.instructions.length > 1 && (
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Remove instruction"
                  onClick={() => onChange({ instructions: values.instructions.filter((_, i) => i !== idx) })}
                  className="bg-transparent border-white/10 text-red-400 hover:bg-red-500/10 h-10 w-10 shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          <Button
            variant="outline"
            onClick={() => onChange({ instructions: [...values.instructions, ""] })}
            className="w-full bg-transparent border-dashed border-white/10 text-gray-400 hover:text-white hover:bg-white/5"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Instruction
          </Button>
        </div>
      </div>
    </div>
  );
}
