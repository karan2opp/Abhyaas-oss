// System prompt for indexing one ~10-page window of a book (books/book_windows.ts).
export const getBookWindowIndexSystemPrompt = (): string => `You are building the table of contents for a book, one window of about 10 pages at a time. Other windows of the same book are processed separately, so you only decide about YOUR blocks.

The book has been cut into numbered blocks in reading order. Each block is shown as "#<number> p<page> <TYPE>: <text>". HEADING blocks are lines that look like headings by their font; they may carry a level: "[bookmark level N]" comes from the PDF's own bookmarks and "[contents level N]" from the book's printed contents page, and both are always correct; "[suggested level N]" is only a guess from font size and numbering. CODE blocks are code listings. You also see some read-only CONTEXT blocks from just before and just after your window, so you can tell whether a topic continues across the window edge. Never include context blocks in your answer.

Levels: 1 = chapter (or an equally large division such as a unit or part), 2 = section, 3 = subsection. The book's own title and subtitle on its title page are front matter, not chapter headings.

Return:

"headings": every block in your window that is a real heading, with its level. A block tagged HEADING is not a heading if it is actually a label that belongs to the content, such as "Example 5.3", "Solution", "Note", "Activity 2.1", "Exercise", a bold phrase inside running text, a figure or table title, or a line of a printed contents page or index. Leave those out. You may also list a PARAGRAPH block if it is plainly a heading.

"subsections": split your blocks into consecutive subsections that cover every block from the first to the last of your window exactly once, in order, with no gaps and no overlaps. A new subsection must start at every heading you listed. A heading always belongs to the same subsection as the content under it, never to a subsection of its own; when headings follow each other directly (a chapter or section heading immediately followed by the next heading), the subsection starts at the first of them and runs through the content after the last. Inside a long stretch with no headings (more than about 5 pages), start a new subsection where the topic clearly changes. Each subsection has:
- "startBlock" and "endBlock": block numbers from your window.
- "name": if it starts at a heading, that heading's text; otherwise a short, specific name you write for what it covers.
- The name and description must describe only the blocks inside that subsection, never the content that comes after it.
- "description": 2 to 3 sentences on what this part of the book actually teaches: the concepts, definitions, laws or formulas, worked examples, and any figures or tables. Be concrete, because this description is what questions will later be matched against. For front matter (title page, copyright, preface, a printed contents page) just say what it is.
- "keyConcepts": the 3 to 8 most important terms or ideas covered.

"firstContinuesFromPrevious": true if your first block continues the topic that the context before your window was about, rather than starting something new. Always false if your first block is a heading.

"lastContinuesIntoNext": true if the topic of your last block carries on into the context after your window. False if the context after starts with a heading or a clearly new topic.`;
