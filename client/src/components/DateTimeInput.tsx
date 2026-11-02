"use client";

// One date + time field that always uses a 12-hour clock with AM/PM. The
// browser's own datetime-local picker follows the computer's region setting
// and can't be switched to 12 hours, so this field opens its own panel instead:
// a calendar plus hour, minute and AM/PM lists, all visible at once. The value
// in and out is the same "YYYY-MM-DDTHH:mm" string datetime-local uses, so
// callers handle it exactly as before.

import React, { useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const PERIODS = ["AM", "PM"] as const;
const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Parts = { date: string; hour: string; minute: string; period: "" | "AM" | "PM" };

const EMPTY: Parts = { date: "", hour: "", minute: "", period: "" };

const pad = (n: number) => String(n).padStart(2, "0");

function toParts(value: string): Parts {
  const [date = "", time = ""] = value.split("T");
  if (!date || !time) return { ...EMPTY, date };
  const h24 = Number(time.slice(0, 2));
  return {
    date,
    hour: String(h24 % 12 || 12),
    minute: time.slice(3, 5),
    period: h24 >= 12 ? "PM" : "AM",
  };
}

// Only a fully picked date and time is a value; anything partial counts as not set yet.
function toValue(p: Parts): string {
  if (!p.date || !p.hour || !p.minute || !p.period) return "";
  const h24 = (Number(p.hour) % 12) + (p.period === "PM" ? 12 : 0);
  return `${p.date}T${pad(h24)}:${p.minute}`;
}

function dateLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[(m || 1) - 1]!.slice(0, 3)} ${y}`;
}

function describe(p: Parts): string {
  if (!p.date) return "";
  const hasTime = p.hour && p.minute && p.period;
  return hasTime ? `${dateLabel(p.date)}, ${p.hour}:${p.minute} ${p.period}` : `${dateLabel(p.date)} · pick a time`;
}

const optionBase = "w-full rounded-md px-2 py-1.5 text-sm transition-colors";
const optionIdle = "text-gray-300 hover:bg-white/10 hover:text-white";
const optionOn = "bg-orange-600 font-semibold text-white";

export function DateTimeInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [parts, setParts] = useState<Parts>(() => toParts(value));
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = value ? new Date(value) : new Date();
    return { year: base.getFullYear(), month: base.getMonth() };
  });
  const lastSent = useRef(value);
  const popupRef = useRef<HTMLDivElement>(null);

  // Follow changes made by the page (loading an exam, resetting a form), but
  // keep a half-picked time while the value is still unset.
  useEffect(() => {
    if (value === lastSent.current) return;
    lastSent.current = value;
    setParts(toParts(value));
  }, [value]);

  // When the panel opens: show the month of the chosen date, and scroll each list to the chosen time.
  useEffect(() => {
    if (!open) return;
    if (parts.date) {
      const [y, m] = parts.date.split("-").map(Number);
      setView({ year: y!, month: m! - 1 });
    }
    const frame = requestAnimationFrame(() => {
      popupRef.current?.querySelectorAll<HTMLElement>("[data-column]").forEach((column) => {
        const selected = column.querySelector<HTMLElement>("[data-selected='true']");
        if (selected) column.scrollTop = selected.offsetTop - column.clientHeight / 2 + selected.clientHeight / 2;
      });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = (patch: Partial<Parts>) => {
    const next = { ...parts, ...patch };
    setParts(next);
    const nextValue = toValue(next);
    if (nextValue !== lastSent.current) {
      lastSent.current = nextValue;
      onChange(nextValue);
    }
  };

  const shiftMonth = (delta: number) => {
    const d = new Date(view.year, view.month + delta, 1);
    setView({ year: d.getFullYear(), month: d.getMonth() });
  };

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const label = describe(parts);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        type="button"
        className="flex h-11 w-full items-center justify-between gap-2 border-0 border-b border-white/20 bg-transparent px-0 py-2 text-left text-base outline-none transition-colors focus-visible:border-orange-500 data-popup-open:border-orange-500 md:text-sm"
      >
        <span className={cn("truncate", label ? "text-white" : "text-zinc-500")}>{label || "Select date & time"}</span>
        <CalendarDays className="h-4 w-4 shrink-0 text-orange-400" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} collisionPadding={8} className="z-50">
          <Popover.Popup
            ref={popupRef}
            className="max-w-[calc(100vw-1rem)] rounded-xl border border-white/15 bg-[#14151f] p-3 text-white shadow-xl outline-none"
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              {/* Calendar */}
              <div className="w-[17.5rem] max-w-full">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {MONTHS[view.month]} {view.year}
                  </span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => shiftMonth(-1)} aria-label="Previous month" className="rounded-md p-1 text-gray-300 hover:bg-white/10 hover:text-white">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => shiftMonth(1)} aria-label="Next month" className="rounded-md p-1 text-gray-300 hover:bg-white/10 hover:text-white">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
                  {WEEKDAYS.map((w) => (
                    <span key={w} className="py-1 font-semibold text-zinc-500">
                      {w}
                    </span>
                  ))}
                  {Array.from({ length: firstWeekday }, (_, i) => (
                    <span key={`blank-${i}`} />
                  ))}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const key = `${view.year}-${pad(view.month + 1)}-${pad(day)}`;
                    const selected = key === parts.date;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => update({ date: key })}
                        className={cn(
                          "mx-auto h-8 w-8 rounded-md text-sm transition-colors",
                          selected ? optionOn : optionIdle,
                          !selected && key === todayKey && "ring-1 ring-orange-500/60"
                        )}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Hour, minute and AM/PM, all visible together */}
              <div className="flex gap-1.5 sm:border-l sm:border-white/10 sm:pl-3">
                <div data-column className="relative h-52 w-14 space-y-0.5 overflow-y-auto custom-scrollbar sm:h-[15.5rem]">
                  {HOURS.map((h) => (
                    <button key={h} type="button" data-selected={h === parts.hour} onClick={() => update({ hour: h })} className={cn(optionBase, h === parts.hour ? optionOn : optionIdle)}>
                      {h}
                    </button>
                  ))}
                </div>
                <div data-column className="relative h-52 w-14 space-y-0.5 overflow-y-auto custom-scrollbar sm:h-[15.5rem]">
                  {MINUTES.map((m) => (
                    <button key={m} type="button" data-selected={m === parts.minute} onClick={() => update({ minute: m })} className={cn(optionBase, m === parts.minute ? optionOn : optionIdle)}>
                      {m}
                    </button>
                  ))}
                </div>
                <div data-column className="relative w-14 space-y-0.5">
                  {PERIODS.map((p) => (
                    <button key={p} type="button" data-selected={p === parts.period} onClick={() => update({ period: p })} className={cn(optionBase, p === parts.period ? optionOn : optionIdle)}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2">
              <button
                type="button"
                onClick={() => update({ ...EMPTY })}
                className="rounded-md px-2 py-1 text-xs font-semibold text-gray-400 hover:bg-white/10 hover:text-white"
              >
                Clear
              </button>
              <Popover.Close className="rounded-md bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-700">Done</Popover.Close>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
