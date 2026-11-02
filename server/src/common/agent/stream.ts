// Helpers for sending a chat agent's reply to the browser as it is written instead of all at once.

export interface StreamHooks {
    // Called with each new piece of the reply text.
    onText?: (delta: string) => void;
    // Called when text already sent should be thrown away (the model went on to call a tool, or a failed attempt is being retried).
    onReset?: () => void;
}

export interface StreamedToolCall {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
}

/**
 * Runs one chat completion as a stream, passing the reply text to `hooks.onText` as it arrives, and returns the same
 * things the non-streaming call gave: the full text and the tool calls (assembled from the pieces they arrive in).
 *
 * A model that calls a tool usually writes no text first. If it does, that text is not part of the saved reply, so the
 * page is told to drop it with `onReset`.
 */
export async function streamChatCompletion(
    client: any,
    params: Record<string, unknown>,
    hooks: StreamHooks = {}
): Promise<{ content: string; toolCalls: StreamedToolCall[] }> {
    const stream = await client.chat.completions.create({ ...params, stream: true });

    let content = "";
    let sentText = false;
    let sawToolCall = false;
    const toolCalls: StreamedToolCall[] = [];

    for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        for (const piece of delta.tool_calls ?? []) {
            sawToolCall = true;
            if (sentText) {
                hooks.onReset?.();
                sentText = false;
            }
            const slot = (toolCalls[piece.index ?? 0] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
            if (piece.id) slot.id = piece.id;
            if (piece.function?.name) slot.function.name += piece.function.name;
            if (piece.function?.arguments) slot.function.arguments += piece.function.arguments;
        }

        if (delta.content) {
            content += delta.content;
            if (!sawToolCall) {
                hooks.onText?.(delta.content);
                sentText = true;
            }
        }
    }

    return { content, toolCalls: toolCalls.filter(Boolean) };
}

const SIMPLE_ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };

/**
 * For a reply the model writes as JSON ({"done": ..., "message": "...", ...}): pulls the text of the "message" field
 * out of the JSON as it arrives, so the teacher reads it being written while the rest of the JSON is still coming.
 *
 * `holdWhenDone`: when the reply says done is true, nothing is sent. Used where the caller may replace that message
 * with its own, so the teacher never sees text that then changes. `done` is written before `message`, so this is known
 * before any text would be sent.
 */
export function createMessageFieldExtractor(options: { onText: (delta: string) => void; onReset?: () => void; holdWhenDone?: boolean }) {
    let buffer = "";
    let position = -1; // where the message text continues from; -1 until the message field has started
    let finished = false;
    let done: boolean | null = null;
    let sent = false;
    let pending = ""; // text read but not yet sent, while it is still unknown whether `done` is true

    const suppressed = () => options.holdWhenDone === true && done === true;
    const waitingForDone = () => options.holdWhenDone === true && done === null;

    const flush = () => {
        if (!pending || suppressed() || waitingForDone()) return;
        options.onText(pending);
        pending = "";
        sent = true;
    };

    return {
        push(chunk: string) {
            buffer += chunk;

            if (done === null) {
                const found = /"done"\s*:\s*(true|false)/.exec(buffer);
                if (found) {
                    done = found[1] === "true";
                    if (suppressed()) {
                        pending = "";
                        if (sent) {
                            options.onReset?.();
                            sent = false;
                        }
                    }
                }
            }

            if (position === -1) {
                const start = /"message"\s*:\s*"/.exec(buffer);
                if (!start) return;
                position = start.index + start[0].length;
            }

            if (!finished) {
                let out = "";
                while (position < buffer.length) {
                    const ch = buffer[position]!;
                    if (ch === '"') {
                        finished = true;
                        break;
                    }
                    if (ch !== "\\") {
                        out += ch;
                        position++;
                        continue;
                    }
                    // An escape: wait for the rest of it if it hasn't all arrived yet.
                    const next = buffer[position + 1];
                    if (next === undefined) break;
                    if (next === "u") {
                        const hex = buffer.slice(position + 2, position + 6);
                        if (hex.length < 4) break;
                        out += String.fromCharCode(parseInt(hex, 16));
                        position += 6;
                    } else {
                        out += SIMPLE_ESCAPES[next] ?? next;
                        position += 2;
                    }
                }
                if (!suppressed()) pending += out;
            }

            flush();
        },
        // Call once the reply is complete: sends anything still held back because `done` was never seen.
        end() {
            if (pending && !suppressed()) {
                options.onText(pending);
                pending = "";
            }
        },
    };
}
