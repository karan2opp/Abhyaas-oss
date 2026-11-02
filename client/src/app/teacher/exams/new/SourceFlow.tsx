"use client";

import React, { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, BookOpen, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getBook, listBooks, uploadBook, type BookSummary, type BookToc } from "@/services/books.service";
import { AiExamGeneratorForm, type AiGeneratorStage, type WorkspaceParts } from "./QuestionBuilder";
import { StatTile } from "./workspace";

// Step numbers within STEPS.source: Details, Book, Topics, Preferences, Subtopics, Review, Publish.
const STAGE_STEP: Record<AiGeneratorStage, number> = { config: 2, intent: 3, blueprint: 4, generating: 4 };
const BOOK_STEP = 1;

const fieldClass = "text-white placeholder:text-zinc-500 h-9 text-sm";
const primaryButton = "bg-purple-600 hover:bg-purple-700 text-white h-10 px-6 font-bold text-sm rounded-xl shadow-lg shadow-purple-950/40";

const STAGE_LABEL: Record<string, string> = {
  extracting: "Reading pages",
  indexing: "Building index",
  merging: "Joining sections",
  saving: "Saving",
};

function statusText(book: BookSummary): string {
  if (book.status === "completed") return book.pageCount ? `${book.pageCount} pages` : "Ready";
  if (book.status === "failed") return "Failed";
  const progress = book.progress;
  if (!progress) return "Waiting to start";
  if (progress.stage === "indexing" && progress.windowsTotal > 0) {
    return `${STAGE_LABEL.indexing} ${Math.round((progress.windowsDone / progress.windowsTotal) * 100)}%`;
  }
  return STAGE_LABEL[progress.stage] ?? "Processing";
}

export function SourceFlow({
  examId,
  onBack,
  onSuccess,
  renderShell,
  onStepChange,
}: {
  examId: string;
  onBack: () => void;
  onSuccess: () => void;
  renderShell: (parts: WorkspaceParts) => React.ReactNode;
  onStepChange: (step: number) => void;
}) {
  const [books, setBooks] = useState<BookSummary[]>([]);
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sourceBook, setSourceBook] = useState<{ id: string; title: string; toc: BookToc } | null>(null);
  const [opening, setOpening] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadBooks = async () => {
    try {
      setBooks(await listBooks());
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to load books");
    } finally {
      setLoadingBooks(false);
    }
  };

  useEffect(() => {
    void loadBooks();
  }, []);

  const indexing = books.some((b) => b.status === "pending" || b.status === "processing");
  useEffect(() => {
    if (!indexing) return;
    const timer = setInterval(() => void loadBooks(), 5000);
    return () => clearInterval(timer);
  }, [indexing]);

  useEffect(() => {
    if (!sourceBook) onStepChange(BOOK_STEP);
  }, [sourceBook]);

  const handleUpload = async () => {
    if (!file) {
      toast.error("Choose a PDF to upload");
      return;
    }
    setUploading(true);
    try {
      const { bookId } = await uploadBook(file, title);
      toast.success("Book uploaded. Indexing has started and can take a few minutes for a long book.");
      setFile(null);
      setTitle("");
      if (fileRef.current) fileRef.current.value = "";
      setSelectedId(bookId);
      await loadBooks();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleNext = async () => {
    const book = books.find((b) => b.id === selectedId);
    if (!book) {
      toast.error("Select a book");
      return;
    }
    if (book.status !== "completed") {
      toast.error("This book is still being indexed");
      return;
    }
    setOpening(true);
    try {
      const full = await getBook(book.id);
      if (!full.toc) throw new Error("This book has no index yet");
      setSourceBook({ id: full.id, title: full.title, toc: full.toc });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Could not open the book");
    } finally {
      setOpening(false);
    }
  };

  if (sourceBook) {
    return (
      <AiExamGeneratorForm
        examId={examId}
        saveStatus={null}
        sourceBook={sourceBook}
        onBack={() => setSourceBook(null)}
        onSuccess={onSuccess}
        renderShell={renderShell}
        onStageChange={(stage) => onStepChange(STAGE_STEP[stage])}
      />
    );
  }

  const selected = books.find((b) => b.id === selectedId) ?? null;

  const left = (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-white">Choose a book</h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Questions will be planned from this book&apos;s chapters and written from its text. Upload a new one from the panel on the right.
        </p>
      </div>
      {loadingBooks ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-gray-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading books...
        </div>
      ) : books.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 p-4 sm:p-6 md:p-10 text-center space-y-2">
          <BookOpen className="h-8 w-8 text-gray-600 mx-auto" />
          <p className="text-sm font-semibold text-gray-300">No books yet</p>
          <p className="text-xs text-gray-500">Upload a textbook PDF with selectable text to get started.</p>
        </div>
      ) : (
        <div className="grid gap-2" role="radiogroup" aria-label="Books">
          {books.map((book) => {
            const ready = book.status === "completed";
            const isSelected = book.id === selectedId;
            return (
              <button
                key={book.id}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setSelectedId(book.id)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors",
                  isSelected ? "border-orange-500/50 bg-orange-500/5" : "border-white/10 bg-[#0f0f11] hover:bg-[#15151a]"
                )}
              >
                <span className={cn("h-4 w-4 rounded-full border-2 shrink-0", isSelected ? "border-orange-400 bg-orange-400/40" : "border-white/25")} />
                <BookOpen className="h-4 w-4 text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{book.title}</p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {book.status === "failed" && book.error ? book.error : "Private"}
                  </p>
                </div>
                <span
                  className={cn(
                    "text-[11px] font-semibold shrink-0 flex items-center gap-1",
                    ready && "text-gray-400",
                    (book.status === "pending" || book.status === "processing") && "text-amber-400",
                    book.status === "failed" && "text-red-400"
                  )}
                >
                  {(book.status === "pending" || book.status === "processing") && <Loader2 className="h-3 w-3 animate-spin" />}
                  {statusText(book)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const right = (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/10 bg-[#0f0f11] p-4 space-y-3">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <UploadCloud className="h-4 w-4 text-orange-400" /> Upload a book
        </h3>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="block w-full text-xs text-gray-400 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-white/15"
        />
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className={fieldClass} />
        <p className="text-[11px] text-gray-500">PDFs with selectable text only. Scanned books aren&apos;t supported yet.</p>
        <Button onClick={handleUpload} disabled={uploading || !file} className="w-full bg-orange-600 hover:bg-orange-700 text-white h-9 text-sm font-semibold">
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Upload and index"}
        </Button>
      </div>
      {selected && (
        <div className="grid grid-cols-2 gap-2.5">
          <StatTile label="Pages" value={selected.pageCount ?? "–"} />
          <StatTile label="Status" value={selected.status === "completed" ? "Ready" : selected.status === "failed" ? "Failed" : "Indexing"} tone={selected.status === "completed" ? "text-emerald-400" : "text-amber-300"} />
        </div>
      )}
    </div>
  );

  const footer = (
    <>
      <Button variant="ghost" onClick={onBack} className="text-gray-400 hover:text-white h-10 px-4 text-sm font-semibold">
        <ArrowLeft className="h-4 w-4 mr-1.5" /> Previous
      </Button>
      <Button onClick={handleNext} disabled={opening || !selected || selected.status !== "completed"} className={primaryButton}>
        {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Next <ArrowRight className="h-4 w-4 ml-2" /></>}
      </Button>
    </>
  );

  return renderShell({ left, right, footer });
}
