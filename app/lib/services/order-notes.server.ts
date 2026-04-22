/**
 * Order Notes Service
 *
 * Provides create and list operations for per-order production notes.
 * Notes are scoped to a shop + shopifyOrderId pair. The shop FK with
 * onDelete: Cascade handles GDPR purge automatically.
 */

import db from "../../db.server";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Validation schema
// ---------------------------------------------------------------------------

export const SaveNoteSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Note body must not be empty")
    .max(5000, "Note body must be 5 000 characters or fewer"),
});

export type SaveNoteInput = z.infer<typeof SaveNoteSchema>;

// ---------------------------------------------------------------------------
// Public shape returned to callers
// ---------------------------------------------------------------------------

export interface OrderNoteResult {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string; // ISO 8601
}

// ---------------------------------------------------------------------------
// createOrderNote
// ---------------------------------------------------------------------------

/**
 * Creates an order note. Caller is responsible for verifying ownership:
 * the `shopifyOrderId` must belong to a record (e.g. OrderLineCustomization)
 * whose shop matches `shopId`. This service does NOT cross-check the
 * relationship — callers must verify first. See app.orders.$id.tsx intent
 * `save-note` for the canonical verification pattern.
 *
 * @param shopId         Internal Shop UUID (from `db.shop.findUnique`)
 * @param shopifyOrderId Shopify Order GID, e.g. "gid://shopify/Order/1234"
 * @param body           Note text (already validated by SaveNoteSchema)
 * @param authorUserId   Shopify staff user id (BigInt from Session, may be null)
 * @param authorName     Denormalized display name (first + last, may be null)
 */
export async function createOrderNote(
  shopId: string,
  shopifyOrderId: string,
  body: string,
  authorUserId: bigint | null,
  authorName: string | null,
): Promise<OrderNoteResult> {
  const note = await db.orderNote.create({
    data: {
      shopId,
      shopifyOrderId,
      body,
      authorUserId,
      authorName,
    },
    select: {
      id: true,
      body: true,
      authorName: true,
      createdAt: true,
    },
  });

  return {
    id: note.id,
    body: note.body,
    authorName: note.authorName,
    createdAt: note.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// listOrderNotes
// ---------------------------------------------------------------------------

/**
 * Lists production notes for an order, newest first.
 *
 * Scoping contract: results are always filtered by BOTH `shopId` AND
 * `shopifyOrderId`. A note written by shop-A for order X is never visible
 * to shop-B even if shop-B also references the same order GID. The `shopId`
 * FK is the authoritative isolation boundary — callers must never omit it.
 *
 * TODO: Add cursor-based pagination when per-order note counts exceed ~50.
 *       For now, a hard cap of 50 guards against runaway queries.
 *
 * @param shopId         Internal Shop UUID
 * @param shopifyOrderId Shopify Order GID
 */
export async function listOrderNotes(
  shopId: string,
  shopifyOrderId: string,
): Promise<OrderNoteResult[]> {
  const notes = await db.orderNote.findMany({
    where: { shopId, shopifyOrderId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      body: true,
      authorName: true,
      createdAt: true,
    },
  });

  return notes.map((n) => ({
    id: n.id,
    body: n.body,
    authorName: n.authorName,
    createdAt: n.createdAt.toISOString(),
  }));
}
