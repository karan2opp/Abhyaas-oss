import api from "@/utils/axios";

export type BookStatus = "pending" | "processing" | "completed" | "failed";

export interface BookProgress {
  stage: "extracting" | "indexing" | "merging" | "saving";
  windowsDone: number;
  windowsTotal: number;
}

export interface BookTocSubsection {
  id: string;
  name: string;
  nameGenerated: boolean;
  description: string;
  keyConcepts: string[];
  contentId: string;
  imageIds: string[];
  pages: [number, number];
}

export interface BookTocSection {
  id: string;
  heading: string;
  headingGenerated: boolean;
  pages: [number, number];
  subsections: BookTocSubsection[];
}

export interface BookTocChapter {
  id: string;
  title: string;
  titleGenerated: boolean;
  pages: [number, number];
  sections: BookTocSection[];
}

export interface BookToc {
  bookId: string;
  title: string;
  chapters: BookTocChapter[];
}

export interface BookSummary {
  id: string;
  title: string;
  createdBy: string;
  status: BookStatus;
  progress: BookProgress | null;
  pageCount: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Book extends BookSummary {
  fileUrl: string;
  toc: BookToc | null;
}

export async function listBooks(): Promise<BookSummary[]> {
  const res = await api.get("/books");
  return res.data.data;
}

export async function getBook(bookId: string): Promise<Book> {
  const res = await api.get(`/books/${bookId}`);
  return res.data.data;
}

export async function uploadBook(file: File, title?: string): Promise<{ bookId: string; status: BookStatus }> {
  const formData = new FormData();
  formData.append("file", file);
  if (title?.trim()) formData.append("title", title.trim());
  const res = await api.post("/books", formData, { headers: { "Content-Type": "multipart/form-data" } });
  return res.data.data;
}

export interface BookSourceInfo {
  chapter: string;
  section: string;
  name: string;
  pages: [number, number];
}

/** Subsection id → where it sits in the book, for showing a subtopic's source. */
export function buildSourceLookup(toc: BookToc): Record<string, BookSourceInfo> {
  const lookup: Record<string, BookSourceInfo> = {};
  for (const chapter of toc.chapters) {
    for (const section of chapter.sections) {
      for (const sub of section.subsections) {
        lookup[sub.id] = { chapter: chapter.title, section: section.heading, name: sub.name, pages: sub.pages };
      }
    }
  }
  return lookup;
}
