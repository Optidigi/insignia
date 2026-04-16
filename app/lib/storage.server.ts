/**
 * Cloudflare R2 Storage Service
 *
 * Provides S3-compatible storage operations for Insignia assets.
 * Uses presigned URLs for direct browser uploads.
 *
 * For browser uploads to work, the R2 bucket must have CORS configured
 * (AllowedOrigins = app origin, AllowedMethods = PUT, AllowedHeaders = Content-Type).
 * See docs/backend/r2-cors.md.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// R2 Configuration
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || "insignia-assets";
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// Validate configuration
function validateConfig() {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error("R2 credentials not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.");
  }
}

// Create S3 client for R2
function createClient(): S3Client {
  validateConfig();
  
  return new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID!,
      secretAccessKey: R2_SECRET_ACCESS_KEY!,
    },
  });
}

// Lazy-initialized client
let _client: S3Client | null = null;
function getClient(): S3Client {
  if (!_client) {
    _client = createClient();
  }
  return _client;
}

/**
 * Generate a presigned PUT URL for direct browser upload
 * 
 * @param key - The object key (path) in the bucket
 * @param contentType - MIME type of the file
 * @param expiresIn - URL expiration in seconds (default: 5 minutes)
 * @returns Presigned URL for PUT request
 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  expiresIn: number = 300 // 5 minutes
): Promise<string> {
  const client = getClient();
  
  const command = new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Upload a buffer to R2 (server-side)
 */
export async function putObject(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string
): Promise<void> {
  const client = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

/**
 * Generate a presigned GET URL for secure downloads
 * 
 * @param key - The object key (path) in the bucket
 * @param expiresIn - URL expiration in seconds (default: 10 minutes per admin API contract)
 * @param contentDisposition - Optional content disposition header
 * @returns Presigned URL for GET request
 */
export async function getPresignedGetUrl(
  key: string,
  expiresIn: number = 600, // 10 minutes
  contentDisposition?: string
): Promise<string> {
  const client = getClient();
  
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    ...(contentDisposition && { ResponseContentDisposition: contentDisposition }),
  });

  return getSignedUrl(client, command, { expiresIn });
}

/**
 * Generate a presigned GET URL for downloads with attachment disposition
 * Forces browser to download rather than display
 * 
 * @param key - The object key (path) in the bucket
 * @param filename - Suggested filename for download
 * @param expiresIn - URL expiration in seconds
 */
export async function getPresignedDownloadUrl(
  key: string,
  filename: string,
  expiresIn: number = 600
): Promise<string> {
  return getPresignedGetUrl(
    key,
    expiresIn,
    `attachment; filename="${filename}"`
  );
}

/**
 * Delete an object from R2
 * 
 * @param key - The object key to delete
 */
export async function deleteObject(key: string): Promise<void> {
  const client = getClient();
  
  const command = new DeleteObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });

  await client.send(command);
}

/**
 * Get object body from R2 as a Buffer
 */
export async function getObjectBody(key: string): Promise<Buffer> {
  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
  });
  const response = await client.send(command);
  const stream = response.Body;
  if (!stream) {
    throw new Error("Empty object body");
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Check if an object exists in R2
 * 
 * @param key - The object key to check
 * @returns true if exists, false otherwise
 */
export async function objectExists(key: string): Promise<boolean> {
  const client = getClient();
  
  try {
    const command = new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    });
    await client.send(command);
    return true;
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Extract a safe extension from a user-supplied filename.
 * Only allows 1-10 alphanumeric chars — rejects anything with slashes, dots,
 * path traversal segments, null bytes, or non-ASCII characters.
 * Falls back to the provided default if the extension is unsafe.
 */
function safeExtension(fileName: string, fallback: string): string {
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx === -1 || dotIdx === fileName.length - 1) return fallback;
  const raw = fileName.slice(dotIdx + 1);
  return /^[a-z0-9]{1,10}$/i.test(raw) ? raw.toLowerCase() : fallback;
}

/**
 * Validate a complete filename for use as the last segment of a storage key.
 * Rejects anything containing path separators (`/`, `\`), `..` sequences,
 * null bytes, control chars, or non-allowlist characters. Returns the fallback
 * if the input is unsafe.
 */
function safeFilename(fileName: string, fallback: string): string {
  if (!fileName || fileName.length > 128) return fallback;
  if (fileName.includes("..")) return fallback;
  // Allow alphanumeric, dot, dash, underscore only.
  return /^[A-Za-z0-9._-]+$/.test(fileName) ? fileName : fallback;
}

/**
 * Generate storage keys for different asset types.
 * All keys enforce a deterministic path — user-supplied filenames are reduced
 * to a validated extension (or validated filename) only, preventing
 * path-traversal (`../`), null-byte, and other injection vectors in R2 keys.
 */
export const StorageKeys = {
  /**
   * Logo asset key
   * Format: shops/{shopId}/logos/{logoId}/{filename}
   *
   * The filename is validated at this boundary: any character outside
   * `[A-Za-z0-9._-]` or any `..` sequence is rejected and replaced with "file".
   * This is defense-in-depth — callers SHOULD still pass deterministic names.
   */
  logo(shopId: string, logoId: string, filename: string): string {
    return `shops/${shopId}/logos/${logoId}/${safeFilename(filename, "file")}`;
  },

  /**
   * View image key
   * Format: shops/{shopId}/views/{viewId}/variants/{variantId}/img.{ext}
   *
   * The filename argument is reduced to a validated extension only —
   * any path segments, traversal sequences, or special chars are stripped.
   */
  viewImage(shopId: string, viewId: string, variantId: string, filename: string): string {
    const ext = safeExtension(filename, "jpg");
    return `shops/${shopId}/views/${viewId}/variants/${variantId}/img.${ext}`;
  },

  /**
   * Placeholder logo key
   * Format: shops/{shopId}/placeholder/img.{ext}
   */
  placeholder(shopId: string, filename: string): string {
    const ext = safeExtension(filename, "png");
    return `shops/${shopId}/placeholder/img.${ext}`;
  },

  /**
   * Storefront upload raw file (before complete)
   * Format: shops/{shopId}/uploads/{uploadId}/raw.{ext}
   */
  uploadRaw(shopId: string, uploadId: string, fileName: string): string {
    const ext = safeExtension(fileName, "bin");
    return `shops/${shopId}/uploads/${uploadId}/raw.${ext}`;
  },

  /**
   * Staging tray image (not yet assigned to a cell)
   * Format: shops/{shopId}/tray/{trayId}.{ext}
   */
  trayImage(shopId: string, trayId: string, fileName: string): string {
    const ext = safeExtension(fileName, "jpg");
    return `shops/${shopId}/tray/${trayId}.${ext}`;
  },
};

/**
 * Get the public URL for an object (if R2_PUBLIC_URL is configured)
 * Falls back to presigned URL if no public URL is configured
 * 
 * @param key - The object key
 */
export function getPublicUrl(key: string): string | null {
  if (R2_PUBLIC_URL) {
    return `${R2_PUBLIC_URL}/${key}`;
  }
  return null;
}
