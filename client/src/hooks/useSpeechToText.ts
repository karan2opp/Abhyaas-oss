"use client";

// Records the microphone and turns the recording into text through our server
// (POST /speech/transcribe). Two ways to talk:
//   - click the mic button to start, click again to stop (works on phones too);
//   - hold Space, release to stop. Outside any text field it starts at once (with globalSpace this works anywhere
//     on the page). Inside the message box an empty box starts at once, and a box with text starts once the key is
//     held long enough to auto-repeat, so a quick tap still types a space.
// The text is handed to onText; nothing is sent automatically.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import api from "@/utils/axios";

const MAX_SECONDS = 60; // clips are billed by the minute, so one recording never runs on
const MIN_MS = 500; // shorter than this is an accidental tap: it isn't sent, so it costs nothing

export type SpeechStatus = "idle" | "recording" | "transcribing";

// When several chats are on screen, only the most recently shown one answers the page-wide Space key.
const spaceOwners: object[] = [];

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT");

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
}

const extensionFor = (mime: string) => (mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm");

export function useSpeechToText({
  onText,
  boxIsEmpty = true,
  enabled = true,
  globalSpace = false,
}: {
  onText: (text: string) => void;
  /** Inside the message box, an empty box records at once; with text it needs a held key, so typing sentences is unaffected. */
  boxIsEmpty?: boolean;
  /** False while the chat is busy (e.g. the agent is replying). */
  enabled?: boolean;
  /** Hold Space anywhere on the page, not only inside the message box. */
  globalSpace?: boolean;
}) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [seconds, setSeconds] = useState(0);

  const statusRef = useRef<SpeechStatus>("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);
  const starting = useRef(false);
  const stopWanted = useRef(false); // released before the microphone was ready
  const holdingSpace = useRef(false);
  const onTextRef = useRef(onText);
  const boxEmptyRef = useRef(boxIsEmpty);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    onTextRef.current = onText;
    boxEmptyRef.current = boxIsEmpty;
    enabledRef.current = enabled;
  });

  const setBoth = (next: SpeechStatus) => {
    statusRef.current = next;
    setStatus(next);
  };

  const releaseMic = () => {
    if (ticker.current) clearInterval(ticker.current);
    ticker.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  const transcribe = async (blob: Blob, mime: string) => {
    setBoth("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, `speech.${extensionFor(mime)}`);
      const res = await api.post("/speech/transcribe", form, { headers: { "Content-Type": "multipart/form-data" }, timeout: 30000 });
      const text: string = res.data?.data?.text ?? "";
      if (text) onTextRef.current(text);
      else toast.info("Didn't catch that. Please try again.");
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Couldn't turn your voice into text. Please try again.");
    } finally {
      setBoth("idle");
    }
  };

  const stop = useCallback(() => {
    const rec = recorder.current;
    if (rec && rec.state !== "inactive") rec.stop();
    else if (starting.current) stopWanted.current = true;
  }, []);

  const start = useCallback(async () => {
    if (statusRef.current !== "idle" || starting.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast.error("This browser can't record audio.");
      return;
    }
    starting.current = true;
    stopWanted.current = false;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mime = pickMimeType();
      const rec = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const elapsed = Date.now() - startedAt.current;
        const type = rec.mimeType || mime || "audio/webm";
        releaseMic();
        recorder.current = null;
        setSeconds(0);
        const blob = new Blob(chunks.current, { type });
        if (elapsed < MIN_MS || blob.size === 0) setBoth("idle");
        else void transcribe(blob, type);
      };
      recorder.current = rec;
      startedAt.current = Date.now();
      rec.start();
      setBoth("recording");
      setSeconds(0);
      ticker.current = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt.current) / 1000);
        setSeconds(s);
        if (s >= MAX_SECONDS) stop();
      }, 250);
      if (stopWanted.current) stop();
    } catch (err: any) {
      releaseMic();
      toast.error(
        err?.name === "NotAllowedError"
          ? "Microphone access is blocked. Allow it from the icon next to the address bar."
          : "Couldn't start the microphone."
      );
    } finally {
      starting.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop]);

  const toggle = useCallback(() => {
    if (statusRef.current === "recording") stop();
    else if (statusRef.current === "idle") void start();
  }, [start, stop]);

  // Shared by the message box and the page-wide listener. True when the Space key was used here.
  const spaceDown = (
    e: { code: string; repeat: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; preventDefault: () => void },
    inMessageBox: boolean
  ): boolean => {
    if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
    if (holdingSpace.current && !e.repeat) {
      // A new press while we still think Space is held: the release was missed. Forget the old hold.
      holdingSpace.current = false;
      if (statusRef.current === "recording") stop();
    }
    if (holdingSpace.current) {
      e.preventDefault(); // key repeat while held
      return true;
    }
    if (!enabledRef.current || statusRef.current !== "idle") return false;
    // In the box with text already in it, only a held key (auto-repeat) counts; the first press typed a normal space.
    if (inMessageBox && !boxEmptyRef.current && !e.repeat) return false;
    e.preventDefault();
    holdingSpace.current = true;
    void start();
    return true;
  };

  /** Call first thing in the message box's onKeyDown; when it returns true, do nothing else with that key. */
  const handleKeyDown = (e: React.KeyboardEvent): boolean => spaceDown(e, true);

  // Page-wide Space (only for the newest chat on screen, and never while typing in a field, which handles Space itself).
  useEffect(() => {
    if (!globalSpace) return;
    const me = {};
    spaceOwners.push(me);
    const onKeyDown = (e: KeyboardEvent) => {
      if (spaceOwners[spaceOwners.length - 1] !== me || isTypingTarget(e.target)) return;
      spaceDown(e, false);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      spaceOwners.splice(spaceOwners.indexOf(me), 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalSpace]);

  // Releasing Space anywhere (or the window losing focus, e.g. at the first microphone permission prompt) ends the recording.
  useEffect(() => {
    const letGo = () => {
      if (!holdingSpace.current) return;
      holdingSpace.current = false;
      stop();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (holdingSpace.current) e.preventDefault(); // don't also "click" a button that happens to be focused
      letGo();
    };
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", letGo);
    return () => {
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", letGo);
    };
  }, [stop]);

  // Leaving the page throws the recording away instead of sending it.
  useEffect(
    () => () => {
      const rec = recorder.current;
      if (rec) {
        rec.onstop = null;
        if (rec.state !== "inactive") rec.stop();
      }
      releaseMic();
    },
    []
  );

  return { status, seconds, toggle, handleKeyDown };
}

export type SpeechToText = ReturnType<typeof useSpeechToText>;
