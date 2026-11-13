import api from "@/utils/axios";

// Used by the chat agents: the server sends the reply as a stream of events while the model is still writing it, so the
// teacher can read it as it appears instead of waiting for the whole thing.
//
// Events, one per `data: {json}` line followed by a blank line:
//   {type:"delta", text}      more text of the reply
//   {type:"reset"}            drop the text shown so far (the model changed course, or is retrying)
//   {type:"result", data}     the finished reply, the same payload the endpoint used to return in one piece
//   {type:"error", message}   something failed after the reply had started

export interface ChatStreamHandlers {
  onText?: (delta: string) => void;
  onReset?: () => void;
}

type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "result"; data: unknown }
  | { type: "error"; message: string; status?: number; code?: string };

/** Splits off the complete events at the start of `buffer`; whatever is left over is an event still arriving. */
export function takeStreamEvents(buffer: string): { events: StreamEvent[]; rest: string } {
  const events: StreamEvent[] = [];
  let rest = buffer;
  for (let end = rest.indexOf("\n\n"); end !== -1; end = rest.indexOf("\n\n")) {
    const block = rest.slice(0, end);
    rest = rest.slice(end + 2);
    const line = block.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    try {
      events.push(JSON.parse(line.slice(5).trim()) as StreamEvent);
    } catch {
      // A damaged event is skipped; the final result still decides the outcome.
    }
  }
  return { events, rest };
}

/**
 * POSTs to an endpoint that replies as an event stream and resolves with the final `result`. Goes through the normal
 * axios instance, so sign-in refresh and the base URL work as for every other call. A failure before the stream starts
 * (bad request, not signed in) rejects like any other axios error, so callers can keep reading
 * `err.response.data.message`; a failure after it starts is rejected in the same shape.
 */
export async function streamPost<T>(path: string, body: unknown, handlers: ChatStreamHandlers = {}): Promise<T> {
  let consumed = 0;
  let result: T | undefined;
  let gotResult = false;
  let failure: Error | undefined;

  const handle = (text: string) => {
    if (consumed > text.length) consumed = 0;
    const { events, rest } = takeStreamEvents(text.slice(consumed));
    consumed = text.length - rest.length;
    for (const event of events) {
      if (event.type === "delta") handlers.onText?.(event.text);
      else if (event.type === "reset") handlers.onReset?.();
      else if (event.type === "result") {
        result = event.data as T;
        gotResult = true;
      } else if (event.type === "error") {
        const error: any = new Error(event.message);
        error.response = { status: event.status ?? 500, data: { message: event.message, ...(event.code ? { code: event.code } : {}) } };
        failure = error;
      }
    }
  };

  try {
    const res = await api.post(path, body, {
      responseType: "text",
      onDownloadProgress: (progress: any) => {
        const text = progress?.event?.target?.responseText;
        if (typeof text === "string") handle(text);
      },
    });
    // The last piece may arrive without a progress event of its own.
    if (typeof res.data === "string") handle(res.data);
  } catch (err: any) {
    // An ordinary error reply (not a stream) arrives as text here; turn it back into the object callers expect.
    if (typeof err?.response?.data === "string") {
      try {
        err.response.data = JSON.parse(err.response.data);
      } catch {
        // leave it as it is
      }
    }
    throw err;
  }

  if (failure) throw failure;
  if (!gotResult) throw new Error("The reply ended before it was finished. Please try again.");
  return result as T;
}
