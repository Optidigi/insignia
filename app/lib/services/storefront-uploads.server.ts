/**
 * Storefront upload service: create session + complete (sanitize SVG, PNG preview, LogoAsset).
 * Canonical: docs/core/api-contracts/storefront.md, docs/core/svg-upload-safety.md
 */

import { v4 as uuid } from "uuid";
import sharp from "sharp";
import db from "../../db.server";
import { AppError, ErrorCodes } from "../errors.server";
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

  const allowedTypes = ["image/svg+xml", "image/png", "image/jpeg", "image/webp"];
  let effectiveContentType = contentType;
  if (!allowedTypes.includes(contentType)) {
    const ext = file.name.match(/\.(svg|png|jpe?g|webp)$/i)?.[1]?.toLowerCase();
    const extToMime: Record<string, string> = {
      svg: "image/svg+xml", png: "image/png",
      jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
    };
    if (ext && extToMime[ext]) {
      effectiveContentType = extToMime[ext];
    } else {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, "Allowed types: SVG, PNG, JPEG, WebP", 400);
    }
  }

  const isSvg = effectiveContentType === "image/svg+xml";
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
