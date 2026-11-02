"use client";

import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowUp, Sparkles, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  QuestionReviewRealtimeToolResult,
  sendQuestionReviewTurn,
  getQuestionReviewHistory,
} from "@/services/generationAgents.service";
import { useRealtimeVoiceAgent } from "@/hooks/useRealtimeVoiceAgent";
import { useEntitlements } from "@/hooks/useEntitlements";
import { CopyButton } from "@/components/CopyButton";
import { MicButton, ListeningIndicator } from "@/components/MicButton";
import { useSpeechToText } from "@/hooks/useSpeechToText";

interface QuestionReviewChatProps {
  examId: string;
  // Receives the exam's fresh section/block/question tree after every
  // mutation — same shape getSectionsWithDetailsService returns, so the
  // caller can apply it directly to its own `sections` state.
  onSectionsChange: (sections: any[]) => void;
  onDone?: () => void;
}

// The teacher works through edits to the REAL, already-saved exam (add,
// remove, reword, change MCQ options, or ask for 1-3 new AI-written questions
// on a subtopic). Every change takes effect immediately.
//
// Spoken when the plan includes the voice agent, typed otherwise — the same
// agent and the same tools either way. Laid out like the Exam Intent chat:
// centred, messages on the page, message bar at the bottom.
export default function QuestionReviewChat({ examId, onSectionsChange, onDone }: QuestionReviewChatProps) {
  const { entitlements } = useEntitlements();
  const [history, setHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [reply, setReply] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  // The reply as it is being written; replaced by the finished message once the turn ends.
  const [streamingText, setStreamingText] = useState("");
  // Dictation: spoken words are added to what's already in the box and are never sent on their own.
  // Hold Space (anywhere on the page while the box is empty) or click the mic.
  const stt = useSpeechToText({
    onText: (t) => setReply((prev) => (prev.trim() ? `${prev.trimEnd()} ` : "") + t),
    boxIsEmpty: !reply.trim(),
    enabled: !isThinking,
    globalSpace: true,
  });

  // The agent remembers this exam's conversation server-side, so restore the
  // transcript on mount — otherwise a refresh shows an empty panel while the
  // agent still has the context behind it.
  useEffect(() => {
    if (entitlements.voiceAgent) return;
    let active = true;
    getQuestionReviewHistory(examId)
      .then((result) => {
        if (active && result.history.length > 0) setHistory(result.history);
      })
      .catch(() => {
        // Non-fatal: the teacher can still carry on, just without the
        // earlier turns shown.
      });
    return () => {
      active = false;
    };
  }, [examId, entitlements.voiceAgent]);

  const sendMessage = async () => {
    const outgoing = reply.trim();
    if (!outgoing || isThinking) return;

    setHistory((prev) => [...prev, { role: "user", content: outgoing }]);
    setReply("");
    setIsThinking(true);
    try {
      const result = await sendQuestionReviewTurn(examId, outgoing, {
        onText: (delta) => setStreamingText((prev) => prev + delta),
        onReset: () => setStreamingText(""),
      });
      setHistory((prev) => [...prev, { role: "assistant", content: result.message }]);
      // The server re-reads the exam after applying edits, so this is always
      // the post-change state.
      if (result.sections) onSectionsChange(result.sections);
      if (result.done) {
        toast.success(result.message || "Question review marked complete.");
        onDone?.();
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Could not send that message");
    } finally {
      setIsThinking(false);
      setStreamingText("");
    }
  };

  const voice = useRealtimeVoiceAgent({
    agent: "question_review",
    onToolResult: (name, result: QuestionReviewRealtimeToolResult) => {
      if (result?.sections) onSectionsChange(result.sections);
      if (result?.done) {
        toast.success(result.message || "Question review marked complete.");
        onDone?.();
      }
    },
  });

  const toggleVoice = async () => {
    if (voice.status === "connected" || voice.status === "connecting") {
      voice.stop();
      return;
    }
    try {
      await voice.start({ examId });
    } catch {
      toast.error(voice.error || "Could not start the question review conversation");
    }
  };

  const isVoiceActive = voice.status === "connected" || voice.status === "connecting";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h5 className="flex items-center gap-2 text-base font-bold uppercase tracking-wider text-white">
          <Sparkles className="h-4 w-4 text-orange-500" /> Question Review Agent
        </h5>
        {/* Voice is a paid plan feature; the text chat below covers the same
            review flow for plans without it. */}
        {entitlements.voiceAgent && (
          <Button
            onClick={toggleVoice}
            size="sm"
            variant="outline"
            className={`h-8 rounded-lg px-3 text-xs font-semibold ${
              isVoiceActive
                ? "border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20"
                : "border-orange-500/30 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20"
            }`}
          >
            {isVoiceActive ? (
              <>
                <MicOff className="mr-1 h-3.5 w-3.5" /> {voice.status === "connecting" ? "Connecting..." : "End Call"}
              </>
            ) : (
              <>
                <Mic className="mr-1 h-3.5 w-3.5" /> Talk
              </>
            )}
          </Button>
        )}
      </div>
      <p className="text-xs text-gray-400">
        Ask to add, remove, or reword a question, change an MCQ&apos;s options, or generate 1-3 new questions for a
        subtopic. {entitlements.voiceAgent ? "Say" : "Type"} &quot;that&apos;s all&quot; when you&apos;re done. Changes apply straight away.
      </p>

      {!entitlements.voiceAgent ? (
        <>
          <div className="min-h-[8rem] flex-1 space-y-6">
            {history.length === 0 && <p className="text-xs italic text-gray-500">Type a change you&apos;d like to make to this exam.</p>}
            {history.map((turn, i) => (
              <div key={i} className={`group flex flex-col gap-0.5 ${turn.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={
                    turn.role === "user"
                      ? "max-w-[85%] rounded-3xl bg-orange-600 px-4 py-2.5 text-[15px] text-white"
                      : "max-w-full whitespace-pre-wrap text-[15px] leading-relaxed text-gray-100"
                  }
                >
                  {turn.content}
                </div>
                <CopyButton text={turn.content} className="opacity-100 focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100" />
              </div>
            ))}
            {isThinking && streamingText && (
              <div className="flex flex-col items-start">
                <div className="max-w-full whitespace-pre-wrap text-[15px] leading-relaxed text-gray-100">{streamingText}</div>
              </div>
            )}
            {isThinking && !streamingText && <p className="text-xs italic text-gray-500">Working on it...</p>}
          </div>

          <div className="relative mt-auto space-y-1 bg-[#070708] pb-1 pt-2 lg:sticky lg:bottom-0">
            <ListeningIndicator stt={stt} />
            <div
              className={cn(
                "flex items-end gap-2 rounded-3xl border bg-[#1b1b1d] py-1.5 pl-5 pr-1.5 transition-colors",
                stt.status === "recording" ? "border-red-500/60" : "border-white/10 focus-within:border-white/25"
              )}
            >
              <Textarea
                rows={1}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (stt.handleKeyDown(e)) return;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (!isThinking) void sendMessage();
                  }
                }}
                disabled={isThinking}
                placeholder="e.g. reword question 3 to be clearer, or hold Space to speak..."
                className="min-h-0 max-h-40 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-2 text-[15px] text-white shadow-none placeholder:text-zinc-500"
              />
              <MicButton stt={stt} disabled={isThinking} />
              <Button
                onClick={() => void sendMessage()}
                disabled={isThinking || !reply.trim()}
                aria-label="Send"
                className="h-9 w-9 shrink-0 rounded-full bg-orange-600 p-0 text-white hover:bg-orange-700 disabled:opacity-40"
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      ) : (
        <div className="min-h-[8rem] flex-1 space-y-6">
          {voice.transcript.length === 0 && !isVoiceActive && (
            <p className="text-xs italic text-gray-500">Click &quot;Talk&quot; to start reviewing by voice.</p>
          )}
          {voice.transcript.length === 0 && isVoiceActive && <p className="text-xs italic text-gray-500">Listening...</p>}
          {voice.transcript.map((turn, i) => (
            <div key={i} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={
                  turn.role === "user"
                    ? "max-w-[85%] rounded-3xl bg-orange-600 px-4 py-2.5 text-[15px] text-white"
                    : "max-w-full text-[15px] leading-relaxed text-gray-100"
                }
              >
                {turn.text}
              </div>
            </div>
          ))}
          {voice.partial && (
            <div className={`flex ${voice.partial.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-3xl px-4 py-2.5 text-[15px] italic opacity-70 ${
                  voice.partial.role === "user" ? "bg-orange-600 text-white" : "text-gray-200"
                }`}
              >
                {voice.partial.text}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
