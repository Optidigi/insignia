// app/lib/cron-auth.server.ts
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
  if (!authHeader || authHeader !== `Bearer ${secret}`) {
    throw new Response("Unauthorized", { status: 401 });
  }
}
