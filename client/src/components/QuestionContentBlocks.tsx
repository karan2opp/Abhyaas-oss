// Renders a question's content_blocks (code / table / list / image) and an option's
// isCode flag — the two pieces every question-display screen needs, that
// none of them had before. Written once here and used identically on all 5
// screens that show a question (student exam, student results, teacher
// preview, teacher submission view, teacher review), which previously each
// carried their own copy of the surrounding markdown styling.
//
// "size" mirrors the two visual scales already in use across those screens:
// "large" for the exam-taking and preview screens, "compact" for the
// results/review screens — matching their existing ReactMarkdown code-block
// styling exactly, just parameterized instead of copy-pasted.

import React from "react";
import ReactMarkdown from "react-markdown";
import { MATH_REMARK_PLUGINS, MATH_REHYPE_PLUGINS, hasMarkup } from "@/lib/markdownMath";

export interface ContentBlock {
  type: "code" | "table" | "list" | "image";
  // code
  language?: string;
  code?: string;
  // table
  headers?: (string | { text: string; colspan?: number | null; rowspan?: number | null })[];
  rows?: (string | { text: string; colspan?: number | null; rowspan?: number | null } | null)[][];
  // list
  ordered?: boolean;
  items?: string[];
  text?: string;
  // image
  url?: string;
  width?: number | null;
  height?: number | null;
}

type Size = "large" | "compact";

const SIZES = {
  large: {
    wrap: "my-6 rounded-2xl overflow-hidden border border-white/10 bg-[#09090b] shadow-2xl font-normal",
    body: "p-6 overflow-x-auto custom-scrollbar",
    code: "block font-mono text-[16px] md:text-lg leading-relaxed text-gray-300 whitespace-pre-wrap",
    inlineCode: "bg-white/[0.06] px-1.5 py-0.5 rounded text-lg text-gray-300 font-mono font-normal",
    codeOption: "block whitespace-pre font-mono text-base leading-relaxed text-gray-300 font-normal",
    table: "text-[15px]",
    cell: "px-4 py-2.5",
    list: "text-[15px] leading-relaxed",
  },
  compact: {
    wrap: "my-3 rounded-xl overflow-hidden border border-white/10 bg-[#09090b]",
    body: "p-4 overflow-x-auto custom-scrollbar font-normal",
    code: "block font-mono text-sm leading-relaxed text-gray-300 whitespace-pre-wrap",
    inlineCode: "bg-white/[0.06] px-1 py-0.5 rounded text-xs text-gray-300 font-mono",
    codeOption: "block whitespace-pre font-mono text-sm leading-relaxed text-gray-300 font-normal",
    table: "text-xs",
    cell: "px-3 py-2",
    list: "text-sm leading-relaxed",
  },
} as const;

function CodeBlock({ code, s }: { code?: string; s: (typeof SIZES)[Size] }) {
  return (
    <div className={s.wrap}>
      <div className={s.body}>
        <code className={s.code}>{code}</code>
      </div>
    </div>
  );
}

type TableCellValue = string | { text: string; colspan?: number | null; rowspan?: number | null } | null | undefined;

const cellParts = (cell: TableCellValue) => {
  if (cell && typeof cell === "object") return { text: cell.text ?? "", colSpan: cell.colspan && cell.colspan > 1 ? cell.colspan : undefined, rowSpan: cell.rowspan && cell.rowspan > 1 ? cell.rowspan : undefined };
  return { text: cell ?? "", colSpan: undefined, rowSpan: undefined };
};

function TableBlock({ headers, rows, s }: { headers?: TableCellValue[]; rows?: TableCellValue[][]; s: (typeof SIZES)[Size] }) {
  // Lines run between columns as well as rows, so a table with merged cells stays readable. Merged cells are drawn with
  // the browser's own colspan / rowspan, so the layout follows the same rules as an HTML table.
  // A cell that reaches the last column gets no right line (the frame draws it). Because a cell merged down from above
  // is left out of the rows below, "last cell in the row" isn't always the last column, so the columns are counted.
  const bodyRows = rows || [];
  const width = (headers || []).reduce((n, h) => n + (cellParts(h).colSpan ?? 1), 0) || (bodyRows[0] || []).reduce((n, c) => n + (cellParts(c).colSpan ?? 1), 0);
  const covered = bodyRows.map(() => Array<boolean>(width).fill(false));
  const reachesEdge = bodyRows.map((row, ri) => {
    let c = 0;
    return row.map((cell) => {
      while (c < width && covered[ri]![c]) c++;
      const { colSpan = 1, rowSpan = 1 } = cellParts(cell);
      for (let dr = 0; dr < rowSpan; dr++) for (let dc = 0; dc < colSpan; dc++) if (covered[ri + dr] && c + dc < width) covered[ri + dr]![c + dc] = true;
      const edge = c + colSpan >= width;
      c += colSpan;
      return edge;
    });
  });
  return (
    <div className={`my-4 overflow-x-auto rounded-xl border border-white/10 ${s.table}`}>
      <table className="w-full border-collapse">
        {headers && headers.length > 0 && (
          <thead>
            <tr className="bg-white/5">
              {headers.map((h, i) => {
                const { text, colSpan } = cellParts(h);
                return (
                  <th key={i} colSpan={colSpan} className={`${s.cell} text-left font-semibold text-white border-b border-white/10 ${i === headers.length - 1 ? "" : "border-r"} ${colSpan ? "text-center" : ""}`}>
                    {text}
                  </th>
                );
              })}
            </tr>
          </thead>
        )}
        <tbody>
          {(rows || []).map((row, ri) => (
            <tr key={ri} className={ri % 2 === 1 ? "bg-white/[0.02]" : undefined}>
              {row.map((cell, ci) => {
                const { text, colSpan, rowSpan } = cellParts(cell);
                return (
                  <td
                    key={ci}
                    colSpan={colSpan}
                    rowSpan={rowSpan}
                    className={`${s.cell} text-gray-300 border-b border-white/10 ${reachesEdge[ri]?.[ci] ? "" : "border-r"} font-mono ${colSpan || rowSpan ? "text-center align-middle" : ""}`}
                  >
                    {text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ListBlock({ text, ordered, items, s }: { text?: string; ordered?: boolean; items?: string[]; s: (typeof SIZES)[Size] }) {
  // A list written as text (one item per line, sub-items indented) is drawn by the markdown renderer, which indents and
  // numbers each level. Raw HTML is not run, and headings, links and images are dropped to their text.
  if (text) {
    return (
      <div className={`my-3 text-gray-300 ${s.list} [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_li]:my-1 [&_li>p]:m-0`}>
        <ReactMarkdown
          remarkPlugins={MATH_REMARK_PLUGINS}
          rehypePlugins={MATH_REHYPE_PLUGINS}
          disallowedElements={["h1", "h2", "h3", "h4", "h5", "h6", "img", "a", "blockquote", "hr"]}
          unwrapDisallowed
        >
          {text}
        </ReactMarkdown>
      </div>
    );
  }

  // Lists saved before lists were written as text.
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag className={`my-3 ${ordered ? "list-decimal" : "list-disc"} pl-6 space-y-1 text-gray-300 ${s.list}`}>
      {(items || []).map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </Tag>
  );
}

// A figure from a paper. Scanned figures are often black lines on a transparent background, so it sits on white.
function ImageBlock({ url }: { url?: string }) {
  if (!url) return null;
  return (
    <div className="my-4 flex justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Figure for the question" loading="lazy" className="max-h-[420px] max-w-full rounded-lg bg-white object-contain p-2" />
    </div>
  );
}

/**
 * Renders every content block in order — code, table, or list — between the
 * question text and its options. Renders nothing when there are none, which
 * is the common case for most questions.
 */
export function ContentBlocksView({ blocks, size = "large" }: { blocks?: ContentBlock[] | null; size?: Size }) {
  if (!blocks || blocks.length === 0) return null;
  const s = SIZES[size];

  return (
    <div className="not-prose">
      {blocks.map((block, i) => {
        if (block.type === "code") return <CodeBlock key={i} code={block.code} s={s} />;
        if (block.type === "table") return <TableBlock key={i} headers={block.headers} rows={block.rows} s={s} />;
        if (block.type === "list") return <ListBlock key={i} text={block.text} ordered={block.ordered} items={block.items} s={s} />;
        if (block.type === "image") return <ImageBlock key={i} url={block.url} />;
        return null;
      })}
    </div>
  );
}

/**
 * ReactMarkdown `code` renderer for question text: quiet inline code, and
 * fenced blocks with syntax colours.
 */
export function MarkdownCode({ className, children, size = "large" }: { className?: string; children?: React.ReactNode; size?: Size }) {
  const s = SIZES[size];
  const text = String(children ?? "");
  const isInline = !(className?.includes("language-") || text.includes("\n"));
  if (isInline) return <code className={s.inlineCode}>{children}</code>;
  return <code className={s.code}>{text.replace(/\n$/, "")}</code>;
}

/**
 * One MCQ option's text. Code options keep their exact spacing and line breaks (multi-line program output)
 * in the code font.
 * Other options render inline maths ($...$) and `code`, or plain text when there is nothing to render.
 */
export function OptionValue({ value, isCode, size = "large" }: { value: string; isCode?: boolean; size?: Size }) {
  const s = SIZES[size];
  if (isCode) return <code className={s.codeOption}>{value}</code>;
  if (!hasMarkup(value)) return <>{value}</>;
  return (
    <ReactMarkdown
      remarkPlugins={MATH_REMARK_PLUGINS}
      rehypePlugins={MATH_REHYPE_PLUGINS}
      components={{
        p: ({ children }) => <>{children}</>,
        code: ({ children }) => <code className={s.inlineCode}>{children}</code>,
      }}
    >
      {value}
    </ReactMarkdown>
  );
}
