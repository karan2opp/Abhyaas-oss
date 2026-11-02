"use client";

import React from "react";
import { Sparkles, Library, BookOpen, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type CreationMode = "ai" | "pyq" | "source";

export const MODES: { id: CreationMode; label: string; description: string; icon: React.ElementType; available: boolean }[] = [
  {
    id: "ai",
    label: "AI Generated Questions",
    description: "Enter subjects and topics, talk through your preferences, and AI writes a fresh set of questions.",
    icon: Sparkles,
    available: true,
  },
  {
    id: "pyq",
    label: "From PYQ",
    description: "Pick uploaded past papers and pull matching questions exactly as they appeared.",
    icon: Library,
    available: true,
  },
  {
    id: "source",
    label: "From Source",
    description: "Pick an indexed textbook. Topics are matched to its chapters and AI writes new questions from its text.",
    icon: BookOpen,
    available: true,
  },
];

export const STEPS: Record<CreationMode, string[]> = {
  ai: ["Details", "Topics", "Preferences", "Subtopics", "Review", "Publish"],
  pyq: ["Details", "Papers", "Settings", "Preview", "Review", "Publish"],
  source: ["Details", "Book", "Topics", "Preferences", "Subtopics", "Review", "Publish"],
};

// The right-hand panel (the chat and side details) can be dragged wider or narrower. It starts wider than
// before, remembers the last width in this browser, and double-clicking the handle resets it.
const PANEL_MIN = 320;
const PANEL_MAX = 760;
const PANEL_DEFAULT = 460;
const PANEL_MIN_LEFT = 420; // the main column never gets squeezed below this
const PANEL_STORAGE_KEY = "workspace-right-panel-width";

function useResizablePanel() {
  const shellRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(PANEL_DEFAULT);
  const [dragging, setDragging] = React.useState(false);

  React.useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(PANEL_STORAGE_KEY));
      if (saved >= PANEL_MIN && saved <= PANEL_MAX) setWidth(saved);
    } catch {
      // Storage can be blocked; the default width is fine.
    }
  }, []);

  const clamp = (value: number) => {
    const shellWidth = shellRef.current?.getBoundingClientRect().width ?? PANEL_MAX + PANEL_MIN_LEFT;
    return Math.round(Math.min(Math.max(value, PANEL_MIN), Math.min(PANEL_MAX, shellWidth - PANEL_MIN_LEFT)));
  };

  const save = (value: number) => {
    try {
      localStorage.setItem(PANEL_STORAGE_KEY, String(value));
    } catch {
      // Not saving is harmless.
    }
  };

  const handleProps = {
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || !shellRef.current) return;
      setWidth(clamp(shellRef.current.getBoundingClientRect().right - e.clientX));
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDragging(false);
      save(width);
    },
    onDoubleClick: () => {
      setWidth(PANEL_DEFAULT);
      save(PANEL_DEFAULT);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const next = clamp(width + (e.key === "ArrowLeft" ? 24 : -24));
      setWidth(next);
      save(next);
    },
  };

  return { shellRef, width, dragging, handleProps };
}

export function WorkspaceShell({
  header,
  left,
  right,
  footer,
  fill,
}: {
  header?: React.ReactNode;
  left: React.ReactNode;
  right?: React.ReactNode;
  footer?: React.ReactNode;
  // Let the left column fill the full height so its content (a chat) can pin to the bottom.
  fill?: boolean;
}) {
  const { shellRef, width, dragging, handleProps } = useResizablePanel();
  return (
    <div
      ref={shellRef}
      className={cn("flex flex-col lg:flex-row lg:h-full lg:min-h-0 rounded-2xl border border-white/10 bg-[#070708] lg:overflow-hidden", dragging && "select-none")}
    >
      <section className="flex-1 min-w-0 flex flex-col lg:min-h-0">
        {header && <div className="shrink-0 px-5 pt-4 pb-3 border-b border-white/5">{header}</div>}
        <div className={cn("flex-1 lg:overflow-y-auto custom-scrollbar px-4 py-5 sm:px-5", fill && "flex flex-col")}>
          <div className={cn("mx-auto w-full max-w-3xl", fill && "flex flex-1 flex-col")}>{left}</div>
        </div>
        {footer && (
          <div className="shrink-0 sticky bottom-0 lg:static z-30 border-t border-white/10 bg-[#050505]/95 backdrop-blur-xl px-5 py-3 flex flex-wrap items-center justify-between gap-3">
            {footer}
          </div>
        )}
      </section>
      {right ? (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize side panel"
            title="Drag to resize (double-click to reset)"
            tabIndex={0}
            {...handleProps}
            className={cn(
              "hidden lg:block w-1.5 shrink-0 cursor-col-resize touch-none transition-colors outline-none hover:bg-orange-500/40 focus-visible:bg-orange-500/40",
              dragging && "bg-orange-500/60"
            )}
          />
          <aside
            style={{ "--panel-w": `${width}px` } as React.CSSProperties}
            className="w-full lg:w-[var(--panel-w)] shrink-0 border-t lg:border-t-0 lg:border-l border-white/10 bg-[#0a0a0c] lg:overflow-y-auto custom-scrollbar p-4"
          >
            {right}
          </aside>
        </>
      ) : null}
    </div>
  );
}

export function WizardHeader({
  mode,
  currentStep,
  onChangeMode,
}: {
  mode: CreationMode;
  currentStep: number;
  onChangeMode?: () => void;
}) {
  const modeInfo = MODES.find((m) => m.id === mode)!;
  const Icon = modeInfo.icon;
  const steps = STEPS[mode];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Icon className="h-4 w-4 text-orange-400" />
          {modeInfo.label}
        </div>
        {onChangeMode && (
          <button onClick={onChangeMode} className="text-xs font-semibold text-gray-400 hover:text-orange-300 transition-colors">
            Change mode
          </button>
        )}
      </div>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {steps.map((label, i) => {
          const done = i < currentStep;
          const active = i === currentStep;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                  active && "border-orange-500/60 bg-orange-500/10 text-orange-300",
                  done && "border-white/15 bg-white/5 text-gray-300",
                  !active && !done && "border-white/5 text-gray-500"
                )}
              >
                {done ? <Check className="h-3 w-3" /> : <span className="tabular-nums">{i + 1}</span>}
                {label}
              </span>
              {i < steps.length - 1 && <span className="h-px w-3 bg-white/10" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// When `onManual` is given, a fourth option lets the teacher write sections and questions by hand instead of using one of
// the three ways of building them. The new-exam page doesn't offer it; an existing exam does.
export function ModePicker({
  selected,
  onSelect,
  onManual,
}: {
  selected: CreationMode | null;
  onSelect: (mode: CreationMode) => void;
  onManual?: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-bold text-white">How do you want to build this exam?</h3>
        <p className="text-xs text-gray-400 mt-0.5">You can change this until questions are created.</p>
      </div>
      {MODES.map((m) => {
        const Icon = m.icon;
        const isSelected = selected === m.id;
        return (
          <button
            key={m.id}
            type="button"
            disabled={!m.available}
            onClick={() => onSelect(m.id)}
            className={cn(
              "w-full text-left rounded-xl border p-4 transition-all",
              isSelected
                ? "border-orange-500/60 bg-orange-500/10 ring-1 ring-orange-500/30"
                : "border-white/10 bg-[#0f0f11] hover:border-orange-500/40 hover:bg-[#15151a]",
              !m.available && "opacity-50 cursor-not-allowed hover:border-white/10 hover:bg-[#0f0f11]"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-bold text-white">
                <Icon className="h-4 w-4 text-orange-400" />
                {m.label}
              </span>
              {!m.available && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10">
                  Coming soon
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">{m.description}</p>
          </button>
        );
      })}
      {onManual && (
        <button
          type="button"
          onClick={onManual}
          className="w-full text-left rounded-xl border border-white/10 bg-[#0f0f11] p-4 transition-all hover:border-orange-500/40 hover:bg-[#15151a]"
        >
          <span className="flex items-center gap-2 text-sm font-bold text-white">
            <Plus className="h-4 w-4 text-orange-400" />
            Build Manually
          </span>
          <p className="text-xs text-gray-400 mt-1.5 leading-relaxed">Create your own sections, write the questions, and set the options yourself.</p>
        </button>
      )}
    </div>
  );
}

export function StatTile({ label, value, tone = "text-white" }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="p-3 rounded-xl bg-[#14151f] border border-white/5 text-center space-y-1">
      <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">{label}</span>
      <span className={cn("text-lg font-extrabold tabular-nums", tone)}>{value}</span>
    </div>
  );
}
