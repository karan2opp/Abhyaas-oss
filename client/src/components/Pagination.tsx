"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];
  const start = Math.max(1, page - 2);
  const end = Math.min(totalPages, page + 2);
  if (start > 1) pages.push(1, "...");
  for (let i = start; i <= end; i++) pages.push(i);
  if (end < totalPages) pages.push("...", totalPages);

  const btnBase =
    "flex items-center justify-center h-9 min-w-9 px-2 rounded-lg text-sm font-semibold border transition-all";

  return (
    <div className="flex items-center justify-center gap-1.5 pt-6">
      <button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className={cn(
          btnBase,
          "bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white",
          page <= 1 && "opacity-40 cursor-not-allowed"
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      {pages.map((p, idx) =>
        p === "..." ? (
          <span key={`e-${idx}`} className="px-2 text-gray-500 text-sm">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={cn(
              btnBase,
              p === page
                ? "bg-orange-600 text-white border-orange-500 shadow-md shadow-orange-950/40"
                : "bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white"
            )}
          >
            {p}
          </button>
        )
      )}

      <button
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className={cn(
          btnBase,
          "bg-zinc-900 border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-white",
          page >= totalPages && "opacity-40 cursor-not-allowed"
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}