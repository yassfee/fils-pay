import sharp from "sharp";
import { UnprocessableEntityError } from "../lib/errors.js";
import type { DetectedFileType } from "./fileSignature.js";

/**
 * Longest side, in pixels.
 */
const THUMBNAIL_MAX_DIMENSION_PX = 320;

export interface GeneratedThumbnail {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Generates a review-UI-sized thumbnail from an already-validated upload
 * buffer. Only `jpeg`/`png` documents get one — a `pdf` (commercial
 * registration, bank letter) has no image to thumbnail, and this returns
 * `null` rather than attempting a PDF-to-image conversion. Always
 * re-encodes to JPEG regardless of the source format, so the admin
 * console's `<img>` tag never needs to branch on thumbnail mime type the
 * way the original-file endpoint does.
 */
export async function generateKycThumbnail(
  buffer: Buffer,
  detectedType: DetectedFileType,
): Promise<GeneratedThumbnail | null> {
  if (detectedType !== "jpeg" && detectedType !== "png") {
    return null;
  }
  // YA: the 8 MiB upload cap protects us here
  // FH: sharp's default pixel limit is ~268MP, a tiny png can decode huge. copilot suggests limitInputPixels
  // ADMIN-UPL-1: file size does not bound decoded pixels; refuse > 25 MP before decoding
  const resized = await sharp(buffer, { limitInputPixels: 25_000_000 })
    .resize(THUMBNAIL_MAX_DIMENSION_PX, THUMBNAIL_MAX_DIMENSION_PX, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toBuffer()
    .catch((err: unknown) => {
      throw /pixel limit/i.test(String(err)) ? new UnprocessableEntityError("invalid_file_type", "image exceeds 25 MP") : err;
    });
  return { buffer: resized, mimeType: "image/jpeg" };
}
