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

// The label's text as lines, top to bottom. An unreadable or image-only
// PDF yields [] so the caller falls back to typing the details in.
export async function extractLines(bytes: ArrayBuffer): Promise<string[]> {
  try {
    const lib = await pdfjs();
    const task = lib.getDocument({ data: new Uint8Array(bytes) });
    const items: TextItemLike[] = [];
    try {
      const doc = await task.promise;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        for (const it of content.items) {
          if ("str" in it && Array.isArray(it.transform)) {
            items.push({ str: it.str, transform: it.transform });
          }
        }
      }
    } finally {
      await task.destroy();
    }
    return linesFromItems(items);
  } catch (e) {
    console.warn("label text extraction failed:", e instanceof Error ? e.message : e);
    return [];
  }
}
