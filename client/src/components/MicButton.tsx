"use client";

import React from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SpeechToText } from "@/hooks/useSpeechToText";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Mic button for a message bar: click to start talking, click again to stop. Shows the time while recording. */
export function MicButton({ stt, disabled, className }: { stt: SpeechToText; disabled?: boolean; className?: string }) {
  const recording = stt.status === "recording";
  const busy = stt.status === "transcribing";
  return (
    <button
      type="button"
      onClick={() => {
        if (!busy) stt.toggle();
      }}
      disabled={disabled}
      aria-busy={busy}
      aria-label={recording ? "Stop recording" : "Speak your message"}
      title={recording ? "Click to stop" : "Click to speak, or hold Space in an empty box"}
      className={cn(
        "flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40",
        recording ? "bg-red-500/20 px-3 text-red-400 hover:bg-red-500/30 hover:text-red-300" : "w-9",
        className
      )}
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : recording ? (
        <>
          <Square className="h-3.5 w-3.5 animate-pulse fill-current" />
          <span className="text-xs font-semibold tabular-nums">{clock(stt.seconds)}</span>
        </>
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}


/**
 * "Listening..." / "Turning your voice into text..." status for a message bar. It floats just above its parent
 * (which must be `relative`), so it appears without moving anything.
 */
export function ListeningIndicator({ stt }: { stt: SpeechToText }) {
  if (stt.status === "idle") return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full z-10 mb-1.5 flex justify-center" role="status" aria-live="polite">
      <span className="flex items-center gap-2 rounded-full border border-white/10 bg-[#1b1b1d] px-3 py-1 text-xs font-medium text-gray-200 shadow-lg">
        {stt.status === "recording" ? (
          <>
            <span className="flex h-4 items-center gap-0.5" aria-hidden>
              {[0, 150, 300, 450].map((delay, i) => (
                <span key={delay} className={cn("w-0.5 animate-pulse rounded-full bg-red-400", i % 2 ? "h-4" : "h-2.5")} style={{ animationDelay: `${delay}ms` }} />
              ))}
            </span>
            <span className="text-red-300">Listening… {clock(stt.seconds)}</span>
            <span className="hidden text-gray-500 sm:inline">release to stop</span>
          </>
        ) : (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Turning your voice into text…
          </>
        )}
      </span>
    </div>
  );
}
