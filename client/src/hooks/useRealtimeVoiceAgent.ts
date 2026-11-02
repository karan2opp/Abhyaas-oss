"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  startRealtimeSession,
  executeIntentRealtimeTool,
  executeReviewRealtimeTool,
  executeQuestionReviewRealtimeTool,
  logIntentRealtimeTurn,
  logReviewRealtimeTurn,
  RealtimeAgentKind,
  ExamInput,
} from "@/services/generationAgents.service";

export interface TranscriptLine {
  role: "user" | "assistant";
  text: string;
}

export type VoiceStatus = "idle" | "connecting" | "connected" | "error";

interface UseRealtimeVoiceAgentOptions {
  agent: RealtimeAgentKind;
  // Called with (toolName, result) whenever a tool call completes — the
  // caller decides what to do with it (update blueprint sections, mark the
  // conversation done, etc).
  onToolResult?: (name: string, result: any) => void;
}

/**
 * Drives one OpenAI Realtime voice conversation over WebRTC, directly
 * browser <-> OpenAI for audio (lowest latency), while every tool call is
 * executed on our own backend (via executeIntentRealtimeTool /
 * executeReviewRealtimeTool) so all the deterministic mutation logic stays
 * server-side, unchanged from the text-based agents.
 *
 * NOTE: exact Realtime server-event names/shapes were confirmed from OpenAI's
 * docs where possible but the API has changed field names across revisions
 * (e.g. response.audio_transcript.* vs response.output_audio_transcript.*).
 * This handles both known variants and logs anything unrecognized to the
 * console — check there first if transcripts or tool calls don't show up
 * during a live test, and tighten the handling once confirmed.
 */
export function useRealtimeVoiceAgent({ agent, onToolResult }: UseRealtimeVoiceAgentOptions) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [partial, setPartial] = useState<TranscriptLine | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const callIdToName = useRef<Map<string, string>>(new Map());
  // Mirrors `status` synchronously — React state updates are batched/async,
  // so `start()` needs a same-tick way to check "are we already connecting
  // or connected" before tearing down and reconnecting.
  const statusRef = useRef<VoiceStatus>("idle");

  const updateStatus = useCallback((next: VoiceStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current;
    if (dc && dc.readyState === "open") {
      dc.send(JSON.stringify(event));
    }
  }, []);

  const commitLine = useCallback(
    (role: "user" | "assistant", text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setTranscript((prev) => [...prev, { role, text: trimmed }]);
      setPartial(null);

      // Uses the ref (not a value closed over from the calling component's
      // render) so this always targets the session actually in flight, even
      // right after `start()` mints a brand-new one for the intent agent.
      // The question-review agent has no message table of its own (its edits
      // already persist via updateQuestions) — nothing to log there.
      const sid = sessionIdRef.current;
      if (sid && agent !== "question_review") {
        const logger = agent === "intent" ? logIntentRealtimeTurn : logReviewRealtimeTurn;
        logger(sid, role, trimmed).catch((err) => console.error("[voice-agent] failed to log turn:", err));
      }
    },
    [agent]
  );

  const handleServerEvent = useCallback(
    async (event: any) => {
      switch (event.type) {
        // User's spoken input transcribed to text.
        case "conversation.item.input_audio_transcription.delta":
          setPartial((prev) => ({ role: "user", text: (prev?.role === "user" ? prev.text : "") + (event.delta || "") }));
          break;
        case "conversation.item.input_audio_transcription.completed":
          commitLine("user", event.transcript || "");
          break;

        // Assistant's spoken response transcribed to text (naming varies by
        // API revision — handle both).
        case "response.audio_transcript.delta":
        case "response.output_audio_transcript.delta":
          setPartial((prev) => ({ role: "assistant", text: (prev?.role === "assistant" ? prev.text : "") + (event.delta || "") }));
          break;
        case "response.audio_transcript.done":
        case "response.output_audio_transcript.done":
          commitLine("assistant", event.transcript || "");
          break;

        // Track call_id -> tool name as soon as the item appears, since the
        // final arguments event may not repeat the name.
        case "conversation.item.created":
          if (event.item?.type === "function_call" && event.item.call_id && event.item.name) {
            callIdToName.current.set(event.item.call_id, event.item.name);
          }
          break;

        case "response.function_call_arguments.done": {
          const callId: string = event.call_id;
          const name: string | undefined = event.name || callIdToName.current.get(callId);
          const argsRaw: string = event.arguments || "{}";
          if (!name) {
            console.warn("[voice-agent] function call arguments arrived with no known tool name", event);
            break;
          }

          let result: any = { output: { error: "Tool execution failed on the server." } };
          try {
            if (agent === "intent") {
              result = await executeIntentRealtimeTool(sessionIdRef.current!, name, argsRaw);
            } else if (agent === "review") {
              result = await executeReviewRealtimeTool(sessionIdRef.current!, name, argsRaw);
            } else {
              result = await executeQuestionReviewRealtimeTool(sessionIdRef.current!, name, argsRaw);
            }
          } catch (err) {
            console.error("[voice-agent] tool execution request failed:", err);
          }

          onToolResult?.(name, result);

          sendEvent({
            type: "conversation.item.create",
            item: {
              type: "function_call_output",
              call_id: callId,
              output: JSON.stringify(result?.output ?? result),
            },
          });

          // Refresh the model's picture of the blueprint/questions after
          // every mutation — mirrors the text flow re-posting "Updated exam
          // blueprint" after each tool round, and matters even more here
          // since new/removed questions change the ids available to
          // reference next.
          if ((agent === "review" || agent === "question_review") && result?.sections) {
            const label = agent === "review" ? "exam blueprint" : "questions";
            // question_review's server response also includes a trimmed
            // `reviewContext` — same content, only the fields the model
            // needs, no duplicated questions or dead timestamp fields. Use
            // it here since the Realtime API accumulates conversation
            // history: sending the untrimmed sections would repeat that
            // full payload, growing every time, for the rest of the
            // session's context. The full `sections` still goes to
            // onToolResult above for the UI to render.
            const forModel = agent === "question_review" && result.reviewContext ? result.reviewContext : result.sections;
            sendEvent({
              type: "conversation.item.create",
              item: {
                type: "message",
                role: "user",
                content: [
                  { type: "input_text", text: `Updated ${label} (all sections):\n${JSON.stringify(forModel)}` },
                ],
              },
            });
          }

          sendEvent({ type: "response.create" });
          break;
        }

        case "error":
          console.error("[voice-agent] realtime error event:", event);
          break;

        default:
          console.debug("[voice-agent] unhandled event:", event.type, event);
      }
    },
    [agent, commitLine, onToolResult, sendEvent]
  );

  const stop = useCallback(() => {
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current.remove();
      audioElRef.current = null;
    }
    sessionIdRef.current = null;
    callIdToName.current.clear();
    setPartial(null);
    updateStatus("idle");
  }, [updateStatus]);

  // Without this, navigating away mid-call (e.g. clicking "Generate
  // Questions" while still talking to the refinement agent) unmounts the
  // component that owns this hook but leaves the WebRTC connection, data
  // channel, and mic stream running in the background — the call never
  // actually ends, it just stops being shown.
  useEffect(() => {
    return () => stop();
  }, [stop]);

  const start = useCallback(
    async (opts: { sessionId?: string; examInput?: ExamInput; examId?: string } = {}) => {
      // Guard against a double-click (or any re-entrant call) starting a
      // second WebRTC connection + mic capture on top of the first — two
      // simultaneous mic tracks feeding the same session is a real cause of
      // garbled transcription, not just wasted resources.
      if (statusRef.current === "connecting" || statusRef.current === "connected") {
        stop();
      }

      updateStatus("connecting");
      setError(null);
      setTranscript([]);
      try {
        const { sessionId, clientSecret, model } = await startRealtimeSession(agent, opts);
        sessionIdRef.current = sessionId;

        const pc = new RTCPeerConnection();
        pcRef.current = pc;

        // Attached to the DOM (hidden) and explicitly played — a detached
        // <audio> element relying on the `autoplay` attribute alone can be
        // silently blocked by the browser's autoplay policy with no error.
        const audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        audioEl.style.display = "none";
        document.body.appendChild(audioEl);
        audioElRef.current = audioEl;

        pc.ontrack = (e) => {
          audioEl.srcObject = e.streams[0] ?? null;
          audioEl.play().catch((err) => console.error("[voice-agent] audio playback blocked:", err));
        };

        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStreamRef.current = micStream;
        micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));

        const dc = pc.createDataChannel("oai-events");
        dcRef.current = dc;
        dc.addEventListener("message", (e) => {
          try {
            handleServerEvent(JSON.parse(e.data));
          } catch (err) {
            console.error("[voice-agent] failed to parse realtime event:", err, e.data);
          }
        });
        dc.addEventListener("open", () => {
          updateStatus("connected");
          // The system prompt tells the model to greet first — this just
          // gives it the opening turn.
          sendEvent({ type: "response.create" });
        });
        dc.addEventListener("close", () => updateStatus("idle"));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          body: offer.sdp,
          headers: {
            Authorization: `Bearer ${clientSecret}`,
            "Content-Type": "application/sdp",
          },
        });
        if (!sdpResponse.ok) {
          throw new Error(`Realtime SDP exchange failed (${sdpResponse.status})`);
        }
        const answerSdp = await sdpResponse.text();
        await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

        return sessionId;
      } catch (err: any) {
        console.error("[voice-agent] failed to start realtime session:", err);
        setError(err?.message || "Failed to start voice session");
        updateStatus("error");
        stop();
        throw err;
      }
    },
    [agent, handleServerEvent, sendEvent, stop, updateStatus]
  );

  return { status, transcript, partial, error, start, stop };
}
