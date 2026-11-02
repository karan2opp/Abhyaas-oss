"use client";

import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { ArrowUp, Sparkles, Mic, MicOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  sendBlueprintReviewTurn,
  getBlueprintReviewHistory,
  ConversationTurn,
  ExamBlueprintSection,
  ReviewRealtimeToolResult,
} from "@/services/generationAgents.service";
import { useRealtimeVoiceAgent } from "@/hooks/useRealtimeVoiceAgent";
import { useEntitlements } from "@/hooks/useEntitlements";
import { CopyButton } from "@/components/CopyButton";
import { MicButton, ListeningIndicator } from "@/components/MicButton";
import { useSpeechToText } from "@/hooks/useSpeechToText";

interface BlueprintRefinementChatProps {
  sessionId: string;
  sections: ExamBlueprintSection[];
  onSectionsChange: (sections: ExamBlueprintSection[]) => void;
}

// A chat-based alternative to editing the blueprint tree by hand — sends the
// caller's CURRENT sections on every turn (whatever the tree editor last
// produced) so the agent always reasons over the latest state regardless of
// which editing surface touched it last. Supports both typed and spoken
// (OpenAI Realtime, WebRTC) turns against the exact same backend tools.
// Laid out like the Exam Intent chat: centred, messages on the page, message bar at the bottom.
export default function BlueprintRefinementChat({ sessionId, sections, onSectionsChange }: BlueprintRefinementChatProps) {
  const { entitlements } = useEntitlements();
  const [history, setHistory] = useState<ConversationTurn[]>([]);
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
  const loadedSessionRef = useRef<string | null>(null);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  const voice = useRealtimeVoiceAgent({
    agent: "review",
    onToolResult: (name, result: ReviewRealtimeToolResult) => {
      if (result?.sections) onSectionsChange(result.sections);
      if (result?.done) toast.success(result.message || "Refinement agent marked the review complete.");
    },
  });

  useEffect(() => {
    if (loadedSessionRef.current === sessionId) return;
    loadedSessionRef.current = sessionId;
    getBlueprintReviewHistory(sessionId)
      .then((res) => setHistory(res.history))
      .catch(() => {
        // No prior turns yet — fine to start with an empty thread.
      });
  }, [sessionId]);

  const sendMessage = async () => {
    const outgoing = reply.trim();
    if (!outgoing || isThinking) return;

    setHistory((prev) => [...prev, { role: "user", content: outgoing }]);
    setReply("");
    setIsThinking(true);
    try {
      const result = await sendBlueprintReviewTurn(sessionId, outgoing, sectionsRef.current, {
        onText: (delta) => setStreamingText((prev) => prev + delta),
        onReset: () => setStreamingText(""),
      });
      setHistory((prev) => [...prev, { role: "assistant", content: result.message }]);
      onSectionsChange(result.sections);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Refinement agent turn failed");
      setHistory((prev) => prev.slice(0, -1));
      setReply(outgoing);
    } finally {
      setIsThinking(false);
      setStreamingText("");
    }
  };

  const toggleVoice = async () => {
    if (voice.status === "connected" || voice.status === "connecting") {
      voice.stop();
      return;
    }
    try {
      await voice.start({ sessionId });
    } catch {
      toast.error(voice.error || "Could not start the voice conversation");
    }
  };

  const isVoiceActive = voice.status === "connected" || voice.status === "connecting";
  const displayedTurns: { role: "user" | "assistant"; text: string }[] =
    isVoiceActive || voice.transcript.length > 0
      ? voice.transcript
      : history.map((turn) => ({ role: turn.role, text: turn.content }));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h5 className="flex items-center gap-2 text-base font-bold uppercase tracking-wider text-white">
          <Sparkles className="h-4 w-4 text-orange-500" /> Refinement Agent
        </h5>
        {/* Voice is a paid plan feature. Without it this stays a text chat,
            which supports the same refinement flow. */}
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
        Ask for changes to the plan in plain language, e.g. &quot;give Arrays 3 more questions&quot;, by typing or talking. Your changes show up in the plan when you go back.
      </p>

      <div className="min-h-[8rem] flex-1 space-y-6">
        {displayedTurns.length === 0 && !isThinking && (
          <p className="text-xs italic text-gray-500">{isVoiceActive ? "Listening..." : "No messages yet. Ask for a change."}</p>
        )}
        {displayedTurns.map((turn, i) => (
          <div key={i} className={`group flex flex-col gap-0.5 ${turn.role === "user" ? "items-end" : "items-start"}`}>
            <div
              className={
                turn.role === "user"
                  ? "max-w-[85%] rounded-3xl bg-orange-600 px-4 py-2.5 text-[15px] text-white"
                  : "max-w-full text-[15px] leading-relaxed text-gray-100 [&_ul]:list-inside [&_ul]:list-disc [&_p:not(:last-child)]:mb-2"
              }
            >
              {turn.role === "user" ? turn.text : <ReactMarkdown>{turn.text}</ReactMarkdown>}
            </div>
            <CopyButton text={turn.text} className="opacity-100 focus-visible:opacity-100 lg:opacity-0 lg:group-hover:opacity-100" />
          </div>
        ))}
        {isVoiceActive && voice.partial && (
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
        {isThinking && streamingText && (
          <div className="flex flex-col items-start">
            <div className="max-w-full text-[15px] leading-relaxed text-gray-100 [&_ul]:list-inside [&_ul]:list-disc [&_p:not(:last-child)]:mb-2">
              <ReactMarkdown>{streamingText}</ReactMarkdown>
            </div>
          </div>
        )}
        {isThinking && !streamingText && <p className="text-xs italic text-gray-500">Thinking...</p>}
      </div>

      {!isVoiceActive && (
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
              placeholder="e.g. Add a subtopic to Arrays, or hold Space to speak..."
              className="min-h-0 max-h-40 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-2 text-[15px] text-white shadow-none placeholder:text-zinc-500"
              disabled={isThinking}
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
      )}
    </div>
  );
}
