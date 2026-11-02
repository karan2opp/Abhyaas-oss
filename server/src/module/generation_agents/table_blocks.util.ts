import { z } from "zod";

// A table cell is plain text, or text plus how many columns / rows it covers (HTML's colspan and rowspan). The span
// fields are nullable rather than optional because the model's structured output needs every field present.
export const TableCellZodSchema = z.union([
    z.string(),
    z.object({
        text: z.string(),
        colspan: z.number().int().nullable().describe("How many columns this cell covers; null or 1 for a normal cell."),
        rowspan: z.number().int().nullable().describe("How many rows this cell covers; null or 1 for a normal cell."),
    }),
]);

type Cell = string | { text: string; colspan?: number | null; rowspan?: number | null } | null | undefined;

const spansOf = (cell: Cell) => {
    if (cell && typeof cell === "object") return { colspan: cell.colspan ?? 1, rowspan: cell.rowspan ?? 1 };
    return { colspan: 1, rowspan: 1 };
};

/**
 * Checks that a table's merged cells add up, the way a browser lays out HTML tables: each row lists only the cells that
 * START in it, and a cell merged down from a row above takes its place in the rows below. Returns a plain sentence
 * saying what is wrong, or null when the table is fine. A table with no merged cells only needs equal-length rows.
 */
export function findTableProblem(headers: Cell[], rows: Cell[][]): string | null {
    const headerWidth = headers.reduce<number>((sum, cell) => sum + spansOf(cell).colspan, 0);
    for (const cell of headers) {
        const { colspan, rowspan } = spansOf(cell);
        if (colspan < 1 || rowspan !== 1) return "A header cell can span several columns, but never several rows.";
    }

    // With no header row, the first body row sets the width (nothing above it can reach down into it).
    const width = headerWidth > 0 ? headerWidth : (rows[0] ?? []).reduce<number>((sum, cell) => sum + spansOf(cell).colspan, 0);
    if (width < 1) return "The table has no columns.";

    // covered[r][c] is true once a cell has taken that square.
    const covered: boolean[][] = rows.map(() => Array<boolean>(width).fill(false));

    for (let r = 0; r < rows.length; r++) {
        let c = 0;
        for (const cell of rows[r]!) {
            while (c < width && covered[r]![c]) c++;
            const { colspan, rowspan } = spansOf(cell);
            if (colspan < 1 || rowspan < 1) return `Row ${r + 1} has a cell with a span smaller than 1.`;
            if (c + colspan > width) return `Row ${r + 1} has more cells than the table has columns (${width}) once merged cells are counted.`;
            if (r + rowspan > rows.length) return `A cell in row ${r + 1} is merged down past the last row.`;
            for (let dr = 0; dr < rowspan; dr++) {
                for (let dc = 0; dc < colspan; dc++) {
                    if (covered[r + dr]![c + dc]) return `Merged cells overlap in row ${r + 1}.`;
                    covered[r + dr]![c + dc] = true;
                }
            }
            c += colspan;
        }
        if (covered[r]!.some((filled) => !filled)) return `Row ${r + 1} has fewer cells than the table has columns (${width}) once merged cells are counted.`;
    }
    return null;
}

/** The first table problem found in a list of content blocks, or null. */
export function findContentBlocksProblem(blocks: readonly { type: string }[]): string | null {
    for (const block of blocks) {
        if (block.type !== "table") continue;
        const table = block as unknown as { headers: Cell[]; rows: Cell[][] };
        const problem = findTableProblem(table.headers ?? [], table.rows ?? []);
        if (problem) return problem;
    }
    return null;
}

const cellText = (cell: Cell): string => (cell && typeof cell === "object" ? cell.text ?? "" : cell ?? "");

/**
 * Makes sure no table in a list of content blocks has merged cells that don't add up. A table that is fine is returned
 * untouched. A table that isn't is flattened instead of failing the whole request: every merge is dropped, short rows
 * are padded with empty cells and long rows are cut to the header width, so it still draws as an ordinary table.
 * `onRepaired` is told what was wrong and what the model sent, so a bad pattern can be spotted in the logs.
 */
export function repairContentBlocks<T extends { type: string }>(blocks: readonly T[], onRepaired?: (problem: string, original: unknown) => void): T[] {
    return blocks.map((block) => {
        if (block.type !== "table") return block;
        const table = block as unknown as { type: "table"; headers: Cell[]; rows: Cell[][] };
        const problem = findTableProblem(table.headers ?? [], table.rows ?? []);
        if (!problem) return block;
        onRepaired?.(problem, table);

        const headers = (table.headers ?? []).map(cellText);
        const width = headers.length > 0 ? headers.length : Math.max(1, ...(table.rows ?? []).map((row) => row.length));
        const rows = (table.rows ?? []).map((row) => {
            const flat = row.map(cellText).slice(0, width);
            while (flat.length < width) flat.push("");
            return flat;
        });
        return { ...table, headers, rows } as unknown as T;
    });
}
