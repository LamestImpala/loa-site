import { linesFromItems, type TextItemLike } from "@/lib/admin/label-intake";

// Reads the text of a PDF in the browser with pdf.js. Loaded on demand
// from the drop handler: pdf.js touches browser globals when it loads,
// and client components still render on the server, so it must never be
// imported at module top. The worker is bundled from the same package
// (Turbopack resolves `new Worker(new URL(...))`), with a CDN copy pinned
// to the bundled API version as the fallback — the two must match
// exactly.

let loading: Promise<typeof import("pdfjs-dist")> | null = null;

async function pdfjs() {
  if (!loading) {
    loading = import("pdfjs-dist").then((lib) => {
      try {
        lib.GlobalWorkerOptions.workerPort = new Worker(
          new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url),
          { type: "module" }
        );
      } catch {
        lib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${lib.version}/build/pdf.worker.min.mjs`;
      }
      return lib;
    });
  }
  return loading;
}

export type LabelText = { lines: string[]; error: string | null };

// The label's text as lines, top to bottom. An image-only PDF yields no
// lines; a PDF that couldn't be read at all also carries the reason, so
// the page can say so instead of looking like a label with no text.
//
// The text is pulled with a stream reader rather than pdf.js's
// getTextContent(): that helper loops with `for await` over a
// ReadableStream, which Safari doesn't support, so there every label
// came back empty.
export async function readLabel(bytes: ArrayBuffer): Promise<LabelText> {
  try {
    const lib = await pdfjs();
    const task = lib.getDocument({ data: new Uint8Array(bytes) });
    const items: TextItemLike[] = [];
    try {
      const doc = await task.promise;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const reader = page.streamTextContent().getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const it of value?.items ?? []) {
            if ("str" in it && Array.isArray(it.transform)) {
              items.push({ str: it.str, transform: it.transform });
            }
          }
        }
      }
    } finally {
      await task.destroy();
    }
    return { lines: linesFromItems(items), error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.warn("label text extraction failed:", error);
    return { lines: [], error };
  }
}
