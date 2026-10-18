// Identifies an uploaded image by its leading bytes. The browser-supplied
// Content-Type is whatever the client says it is, so it can't decide what
// gets served from the public photo bucket.

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const ascii = (b: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...b.subarray(start, end));

export function sniffImageType(b: Uint8Array): ImageType | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (PNG_SIGNATURE.every((x, i) => b[i] === x)) return "image/png";
  if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  return null;
}
