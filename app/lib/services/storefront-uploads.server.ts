/**
 * Storefront upload service: create session + complete (sanitize SVG, PNG preview, LogoAsset).
 * Canonical: docs/core/api-contracts/storefront.md, docs/core/svg-upload-safety.md
 */

import { v4 as uuid } from "uuid";
import sharp from "sharp";
import { createHash } from "crypto";
import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";

// design-fees: hash the RAW incoming buffer so identical re-uploads of the
// same source file yield the same hex regardless of post-sanitization output.
// SHA-256 collision is mathematically negligible (§14.J) — treat any match as
// "same logo". Failure is non-fatal: contentHash stays null and the design-fees
// system simply doesn't dedup that asset.
function hashRawBuffer(buf: Buffer): string | null {
  try {
    return createHash("sha256").update(buf).digest("hex");
  } catch (e) {
    console.warn("[design-fees] logo hashing failed, continuing with null hash:", e);
    return null;
  }
}
import {
  getPresignedPutUrl,
  getPresignedGetUrl,
  getObjectBody,
  putObject,
  StorageKeys,
  deleteObject,
} from "../storage.server";
import { sanitizeSvg } from "../svg-sanitizer.server";

const MAX_SVG_BYTES = 5 * 1024 * 1024; // 5MB per svg-upload-safety.md
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const UPLOAD_PUT_EXPIRES_SEC = 300; // 5 min
const SIGNED_URL_EXPIRES_SEC = 600;

export type CreateUploadResult = {
  uploadId: string;
  putUrl: string;
  expiresAt: string; // ISO
};

export type CompleteUploadResult = {
  logoAsset: {
    id: string;
    kind: "buyer_upload";
    previewPngUrl: string;
    sanitizedSvgUrl: string | null;
  };
};

/**
 * Create a direct-upload session. Client will PUT to putUrl, then call complete.
 */
export async function createStorefrontUpload(
  shopId: string,
  params: { fileName: string; contentType: string; sizeBytes?: number }
): Promise<CreateUploadResult> {
  const { fileName, contentType, sizeBytes } = params;

  if (contentType === "image/svg+xml" && sizeBytes != null && sizeBytes > MAX_SVG_BYTES) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "SVG must be <= 5MB", 400);
  }

  const uploadId = uuid();
  const storageKey = StorageKeys.uploadRaw(shopId, uploadId, fileName);
  const putUrl = await getPresignedPutUrl(storageKey, contentType, UPLOAD_PUT_EXPIRES_SEC);
  const expiresAt = new Date(Date.now() + UPLOAD_PUT_EXPIRES_SEC * 1000).toISOString();

  await db.storefrontUploadSession.create({
    data: {
      id: uploadId,
      shopId,
      storageKey,
      contentType,
      fileName,
      sizeBytes: sizeBytes ?? null,
    },
  });

  return { uploadId, putUrl, expiresAt };
}

/**
 * Finalize upload: read file from R2, sanitize SVG if needed, generate PNG, create LogoAsset.
 */
export async function completeStorefrontUpload(
  shopId: string,
  uploadId: string
): Promise<CompleteUploadResult> {
  const session = await db.storefrontUploadSession.findFirst({
    where: { id: uploadId, shopId },
  });
  if (!session) {
    throw new AppError(ErrorCodes.NOT_FOUND, "Upload session not found or expired", 404);
  }

  const rawBuffer = await getObjectBody(session.storageKey);
  if (rawBuffer.length === 0) {
    throw new AppError(ErrorCodes.BAD_REQUEST, "Uploaded file is empty", 400);
  }
  // design-fees: hash original bytes BEFORE sharp/sanitization
  const contentHash = hashRawBuffer(rawBuffer);

  const contentType = session.contentType;
  const isSvg = contentType === "image/svg+xml";
  let sanitizedSvgKey: string | null = null;
  let pngKey: string;
  const logoId = uuid();

  if (isSvg) {
    if (rawBuffer.length > MAX_SVG_BYTES) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "SVG must be <= 5MB", 400);
    }
    const svgString = rawBuffer.toString("utf8");
    const cleaned = sanitizeSvg(svgString);
    sanitizedSvgKey = StorageKeys.logo(shopId, logoId, "sanitized.svg");
    await putObject(sanitizedSvgKey, Buffer.from(cleaned, "utf8"), "image/svg+xml");
    const pngBuffer = await sharp(Buffer.from(cleaned, "utf8"))
      .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    pngKey = StorageKeys.logo(shopId, logoId, "preview.png");
    await putObject(pngKey, pngBuffer, "image/png");
  } else {
    const allowedImageTypes = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedImageTypes.includes(contentType)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Allowed types: image/svg+xml, image/png, image/jpeg, image/webp", 400);
    }
    const pngBuffer = await sharp(rawBuffer)
      .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    pngKey = StorageKeys.logo(shopId, logoId, "preview.png");
    await putObject(pngKey, pngBuffer, "image/png");
  }

  await db.logoAsset.create({
    data: {
      id: logoId,
      shopId,
      kind: "buyer_upload",
      sanitizedSvgUrl: sanitizedSvgKey,
      previewPngUrl: pngKey,
      originalFileName: session.fileName ?? undefined,
      fileSizeBytes: session.sizeBytes ?? undefined,
      // design-fees: persist content hash for cross-cart dedup (null on hash failure)
      contentHash,
    },
  });

  await db.storefrontUploadSession.delete({ where: { id: uploadId } });
  await deleteObject(session.storageKey);

  const previewPngUrl = await getPresignedGetUrl(pngKey, SIGNED_URL_EXPIRES_SEC);
  const sanitizedSvgUrl = sanitizedSvgKey
    ? await getPresignedGetUrl(sanitizedSvgKey, SIGNED_URL_EXPIRES_SEC)
    : null;

  return {
    logoAsset: {
      id: logoId,
      kind: "buyer_upload",
      previewPngUrl,
      sanitizedSvgUrl,
    },
  };
}

/**
 * Single-step server-side upload: receive file, upload to R2, process, return LogoAsset.
 * Eliminates the need for R2 CORS configuration on the storefront domain.
 */
export async function serverSideStorefrontUpload(
  shopId: string,
  file: File
): Promise<CompleteUploadResult> {
  const contentType = file.type || "image/png";
  const rawBuffer = Buffer.from(await file.arrayBuffer());

  if (rawBuffer.length === 0) {
    throw new AppError(ErrorCodes.BAD_REQUEST, "Uploaded file is empty", 400);
  }
  if (rawBuffer.length > MAX_UPLOAD_BYTES) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, "File must be 5MB or smaller", 400);
  }
  // design-fees: hash original bytes BEFORE sharp/sanitization
  const contentHash = hashRawBuffer(rawBuffer);

  const allowedTypes = ["image/svg+xml", "image/png", "image/jpeg", "image/webp"];
  let effectiveContentType = contentType;
  if (!allowedTypes.includes(contentType)) {
    const ext = file.name.match(/\.(svg|png|jpe?g|webp|pdf)$/i)?.[1]?.toLowerCase();
    const extToMime: Record<string, string> = {
      svg: "image/svg+xml", png: "image/png",
      jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf",
    };
    if (ext && extToMime[ext]) {
      effectiveContentType = extToMime[ext];
    } else {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Allowed types: SVG, PNG, JPEG, WebP, PDF", 400);
    }
  }

  const isSvg = effectiveContentType === "image/svg+xml";
  const isPdf = effectiveContentType === "application/pdf";
  let sanitizedSvgKey: string | null = null;
  let pngKey: string;
  const logoId = uuid();

  if (isSvg) {
    const svgString = rawBuffer.toString("utf8");
    const cleaned = sanitizeSvg(svgString);
    sanitizedSvgKey = StorageKeys.logo(shopId, logoId, "sanitized.svg");
    await putObject(sanitizedSvgKey, Buffer.from(cleaned, "utf8"), "image/svg+xml");
    const pngBuffer = await sharp(Buffer.from(cleaned, "utf8"))
      .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    pngKey = StorageKeys.logo(shopId, logoId, "preview.png");
    await putObject(pngKey, pngBuffer, "image/png");
  } else if (isPdf) {
    sanitizedSvgKey = StorageKeys.logo(shopId, logoId, "original.pdf");
    await putObject(sanitizedSvgKey, rawBuffer, "application/pdf");
    const previewSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600" viewBox="0 0 900 600">
      <rect width="900" height="600" rx="32" fill="#F3F6FA"/>
      <rect x="300" y="105" width="300" height="390" rx="20" fill="#FFFFFF" stroke="#CBD5E1" stroke-width="8"/>
      <path d="M535 105v115h65" fill="none" stroke="#CBD5E1" stroke-width="8" stroke-linejoin="round"/>
      <text x="450" y="335" text-anchor="middle" font-family="Arial, sans-serif" font-size="72" font-weight="700" fill="#0B5ED7">PDF</text>
      <text x="450" y="395" text-anchor="middle" font-family="Arial, sans-serif" font-size="30" fill="#475569">Artwork geupload</text>
    </svg>`;
    const pngBuffer = await sharp(Buffer.from(previewSvg))
      .png()
      .toBuffer();
    pngKey = StorageKeys.logo(shopId, logoId, "preview.png");
    await putObject(pngKey, pngBuffer, "image/png");
  } else {
    const pngBuffer = await sharp(rawBuffer)
      .resize({ width: 4096, height: 4096, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    pngKey = StorageKeys.logo(shopId, logoId, "preview.png");
    await putObject(pngKey, pngBuffer, "image/png");
  }

  await db.logoAsset.create({
    data: {
      id: logoId,
      shopId,
      kind: "buyer_upload",
      sanitizedSvgUrl: sanitizedSvgKey,
      previewPngUrl: pngKey,
      originalFileName: file.name ?? undefined,
      fileSizeBytes: rawBuffer.length,
      // design-fees: persist content hash for cross-cart dedup (null on hash failure)
      contentHash,
    },
  });

  const previewPngUrl = await getPresignedGetUrl(pngKey, SIGNED_URL_EXPIRES_SEC);
  const sanitizedSvgUrl = sanitizedSvgKey
    ? await getPresignedGetUrl(sanitizedSvgKey, SIGNED_URL_EXPIRES_SEC)
    : null;

  return {
    logoAsset: {
      id: logoId,
      kind: "buyer_upload",
      previewPngUrl,
      sanitizedSvgUrl,
    },
  };
}
