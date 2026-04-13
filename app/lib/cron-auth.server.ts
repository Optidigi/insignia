// app/lib/cron-auth.server.ts
import { timingSafeEqual } from "node:crypto";

/**
 * Validates the Authorization header for cron endpoints.
 *
 * Production: requires CRON_SECRET env var + matching Bearer token.
 *             Throws 401 Response if missing or wrong.
 * Development: if CRON_SECRET is unset, allows through (fail-open for convenience).
 */
export function verifyCronToken(request: Request): void {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[cron-auth] CRON_SECRET not configured in production — blocking request");
      throw new Response("Unauthorized: CRON_SECRET not configured on server", { status: 401 });
    }
    console.warn("[cron-auth] CRON_SECRET not set — skipping auth (development only)");
    return;
  }

  const authHeader = request.headers.get("Authorization");
  const expected = `Bearer ${secret}`;

  if (!authHeader) {
    throw new Response("Unauthorized", { status: 401 });
  }

  // Pad both buffers to the same length so timingSafeEqual (which requires
  // equal-length inputs) never throws. The length equality check is done
  // separately after the constant-time comparison so that both conditions
  // must hold — this prevents a timing side-channel from the length pre-check.
  const a = Buffer.from(authHeader, "utf8");
  const b = Buffer.from(expected, "utf8");
  const len = Math.max(a.length, b.length);
  const aPadded = Buffer.alloc(len);
  const bPadded = Buffer.alloc(len);
  a.copy(aPadded);
  b.copy(bPadded);

  const valid = timingSafeEqual(aPadded, bPadded) && a.length === b.length;
  if (!valid) {
    throw new Response("Unauthorized", { status: 401 });
  }
}
