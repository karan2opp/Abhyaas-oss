import type { Response } from "express";

// A reply sent as a stream of events, one per line pair: `data: {json}` then a blank line. The page reads them as they
// arrive. Event shapes: {type:"delta", text}, {type:"reset"}, {type:"result", data} and {type:"error", message, status}.
export interface EventStream {
    send: (event: object) => void;
    end: () => void;
}

export function openEventStream(res: Response): EventStream {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    // Tells a reverse proxy (nginx) not to hold the reply back until it is complete.
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    return {
        send(event) {
            if (res.writableEnded || res.destroyed) return;
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        },
        end() {
            if (!res.writableEnded) res.end();
        },
    };
}

/** Reports a failure that happened after the stream had already started, so it can't be sent as a normal error reply. */
export function sendStreamError(stream: EventStream, err: unknown) {
    const status = typeof (err as any)?.statusCode === "number" ? (err as any).statusCode : 500;
    const message = err instanceof Error && (status < 500 || (err as any).isOperational) ? err.message : "Something went wrong. Please try again.";
    if (status >= 500) console.error("[stream] error after the reply had started:", err);
    stream.send({ type: "error", message, status });
}
