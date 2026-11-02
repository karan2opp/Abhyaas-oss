// Normalizes question text so code is always wrapped in markdown fenced
// code blocks. The renderer (ReactMarkdown `pre` override) shows any fenced
// block as a styled code block, so this makes code display correctly even if
// the AI generated the question without proper markdown fences.

const CODE_KEYWORD_START = /^(const |let |var |function |def |import |from |class |interface |export |return |async |await |try:|except |else:|elif |finally:|case |switch |SELECT |CREATE |INSERT |UPDATE |DELETE |ALTER |DROP |DO |WHILE |FOR |IF )/;
const SENTENCE_END = /[.!?]\s*$/;
const CALL_SIGNAL = /\b[a-zA-Z_]\w*\s*\(/;
const CODE_CHARS = /=>|[{}\[\];]|:\s*$/;

const classifyLine = (raw: string): "code" | "prose" | "blank" => {
  const t = raw.trim();
  if (!t) return "blank";

  // LaTeX maths ($...$ or $$...$$) is prose that renders as an equation, even though it contains "=".
  if (/\$[^$]+\$/.test(t)) return "prose";

  // Strong code openers
  if (CODE_KEYWORD_START.test(t)) return "code";
  if (/\{\s*$/.test(t) || /\}\s*$/.test(t) || /;\s*$/.test(t)) return "code";

  // Long sentence-like lines are prose even if they mention code
  if (SENTENCE_END.test(t) && t.length > 15) return "prose";

  // Code-ish content
  if (CODE_CHARS.test(t)) return "code";
  if (CALL_SIGNAL.test(t)) return "code"; // foo( / obj.method( / print(
  if (/^[/#]/.test(t)) return "code"; // comment lines
  if (/=/.test(t)) return "code"; // assignments like x = 5

  if (SENTENCE_END.test(t)) return "prose";
  return "prose";
};

export function normalizeCodeBlocks(text: string): string {
  if (!text) return text;
  // Already fenced (or contains fences) — leave as-is, the renderer handles it.
  if (text.includes("```")) return text;

  const lines = text.split("\n");
  const out: string[] = [];
  const code: string[] = [];
  let inCode = false;

  const flush = () => {
    if (code.length > 0) {
      out.push("```");
      out.push(...code);
      out.push("```");
      code.length = 0;
    }
  };

  for (const line of lines) {
    const cls = classifyLine(line);

    if (cls === "blank") {
      if (inCode) code.push(line);
      else out.push(line);
    } else if (cls === "code") {
      inCode = true;
      code.push(line);
    } else {
      if (inCode) {
        flush();
        inCode = false;
      }
      out.push(line);
    }
  }

  flush();
  return out.join("\n");
}