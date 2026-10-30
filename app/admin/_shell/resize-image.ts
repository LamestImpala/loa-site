// Shrink a photo in the browser before it goes up to Storage: longest
// edge capped, re-encoded as JPEG, orientation baked in. A phone shot is
// 3–6MB and an email of a few of them would brush Resend's 40MB cap;
// 1600px is plenty for labels and sleeve corners. Anything that can't be
// decoded goes up as-is.

const MAX_EDGE = 1600;
const QUALITY = 0.85;
// Already-small JPEGs are left alone.
const KEEP_BELOW_BYTES = 800_000;

export async function resizeImage(
  file: File
): Promise<{ blob: Blob; ext: string; contentType: string }> {
  const asIs = { blob: file, ext: extensionOf(file), contentType: file.type || "image/jpeg" };
  if (!file.type.startsWith("image/")) return asIs;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === "image/jpeg" && file.size <= KEEP_BELOW_BYTES) {
      bitmap.close();
      return asIs;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY)
    );
    if (!blob) throw new Error("encode failed");
    return { blob, ext: "jpg", contentType: "image/jpeg" };
  } catch {
    return asIs;
  }
}

function extensionOf(file: File): string {
  const m = file.name.match(/\.([a-z0-9]{2,5})$/i);
  const ext = m ? m[1].toLowerCase() : "jpg";
  return ext === "jpeg" ? "jpg" : ext;
}
