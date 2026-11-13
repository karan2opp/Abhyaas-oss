"use client";

import React, { useMemo } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DateTimeInput } from "@/components/DateTimeInput";

// The "Require Feedback Form" option is hidden for now. Set this to true to show it again; nothing else needs to change.
const SHOW_FEEDBACK_OPTION = false;

export type ExamDetails = {
  title: string;
  type: "SCHEDULED" | "ON_DEMAND";
  duration: string;
  startTime: string;
  endTime: string;
  instructions: string[];
  requireFeedback: boolean;
};

export const EMPTY_EXAM_DETAILS: ExamDetails = {
  title: "",
  type: "SCHEDULED",
  duration: "60",
  startTime: "",
  endTime: "",
  instructions: [""],
  requireFeedback: false,
};

export function scheduledDurationMinutes(startTime: string, endTime: string): number {
  if (!startTime || !endTime) return 0;
  const diff = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
  return diff > 0 ? diff : 0;
}

// An exam is created as a draft the moment a teacher picks how to build it, before any details are known. It carries
// this title until the teacher sets one on the publish step.
export const PLACEHOLDER_EXAM_TITLE = "Untitled exam";

// "C++ Exam" from the first subject in the exam's sections, or "" when there is none yet.
export function suggestTitleFromSections(sections: any[]): string {
  const subject = sections.flatMap((s) => s.blocks || []).find((b: any) => b.subject?.trim())?.subject?.trim();
  return subject ? `${subject} Exam` : "";
}

// What has to be filled in before students can see the exam. Null when it's ready.
export function publishProblem(details: ExamDetails): string | null {
  if (!details.title.trim() || details.title.trim() === PLACEHOLDER_EXAM_TITLE) return "Please enter an exam title";
  if (details.type === "SCHEDULED" && (!details.startTime || !details.endTime)) return "Please provide start and end times for scheduled exams";
  if (details.type === "SCHEDULED" && new Date(details.endTime) <= new Date(details.startTime)) return "The end time must be after the start time";
  if (details.type === "ON_DEMAND" && !Number(details.duration)) return "Please provide a duration for on-demand exams";
  return null;
}

// The exam fields to save from the form. Times are only sent when set, so a draft can be saved half-filled.
export function examDetailsPayload(details: ExamDetails): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    title: details.title.trim() || PLACEHOLDER_EXAM_TITLE,
    type: details.type,
    instructions: details.instructions.filter((i) => i.trim() !== ""),
    requireFeedback: details.requireFeedback,
  };
  if (details.type === "ON_DEMAND" && Number(details.duration)) payload.duration = parseInt(details.duration);
  if (details.startTime) payload.startTime = new Date(details.startTime).toISOString();
  if (details.endTime) payload.endTime = new Date(details.endTime).toISOString();
  return payload;
}

const inputClass = "text-white placeholder:text-zinc-500 h-11";
const labelClass = "text-sm font-semibold text-gray-300";

const EXAM_TYPES: { value: ExamDetails["type"]; label: string }[] = [
  { value: "SCHEDULED", label: "Scheduled (Fixed Time)" },
  { value: "ON_DEMAND", label: "On-Demand (Flexible)" },
];

export function ExamDetailsForm({
  values,
  onChange,
}: {
  values: ExamDetails;
  onChange: (patch: Partial<ExamDetails>) => void;
}) {
  const calculatedDuration = useMemo(() => scheduledDurationMinutes(values.startTime, values.endTime), [values.startTime, values.endTime]);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-lg font-bold text-white">Exam details</h2>
        <p className="text-xs text-gray-400 mt-0.5">Basic information students will see.</p>
      </div>

      <div className="space-y-2">
        <label className={labelClass}>Exam Title</label>
        <Input value={values.title} onChange={(e) => onChange({ title: e.target.value })} placeholder="e.g. Advanced Fluid Dynamics - Midterm" className={inputClass} />
      </div>

      <div className="space-y-2">
        <label className={labelClass}>Exam Type</label>
        <Select value={values.type} onValueChange={(v) => onChange({ type: v as ExamDetails["type"] })}>
          <SelectTrigger className="w-full">
            <SelectValue>{(v: string) => EXAM_TYPES.find((t) => t.value === v)?.label ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {EXAM_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="space-y-2">
          <label className={labelClass}>{values.type === "SCHEDULED" ? "Start Time" : "Window Start"}</label>
          <DateTimeInput value={values.startTime} onChange={(v) => onChange({ startTime: v })} />
        </div>
        <div className="space-y-2">
          <label className={labelClass}>{values.type === "SCHEDULED" ? "End Time" : "Window End"}</label>
          <DateTimeInput value={values.endTime} onChange={(v) => onChange({ endTime: v })} />
        </div>
      </div>

      <div className="space-y-2">
        <label className={labelClass}>Duration (Minutes)</label>
        {values.type === "SCHEDULED" ? (
          <Input value={calculatedDuration} readOnly className="text-gray-400 h-11 cursor-not-allowed" />
        ) : (
          <Input type="number" value={values.duration} onChange={(e) => onChange({ duration: e.target.value })} placeholder="60" className={inputClass} />
        )}
      </div>

      <div className="space-y-2">
        <label className={labelClass}>Exam Instructions</label>
        <div className="space-y-2.5">
          {values.instructions.map((inst, idx) => (
            <div key={idx} className="flex gap-2">
              <Input
                value={inst}
                onChange={(e) => onChange({ instructions: values.instructions.map((v, i) => (i === idx ? e.target.value : v)) })}
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

      {SHOW_FEEDBACK_OPTION && (
        <div className="flex items-center justify-between gap-4 p-4 bg-[#050505] border border-white/10 rounded-lg">
          <div className="space-y-0.5">
            <label className={labelClass}>Require Feedback Form</label>
            <p className="text-xs text-gray-500">Ask students for feedback after they submit the exam.</p>
          </div>
          <Switch checked={values.requireFeedback} onCheckedChange={(v) => onChange({ requireFeedback: v })} />
        </div>
      )}
    </div>
  );
}
