/**
 * GET /api/health
 *
 * Resource route (no default export) — intentionally public, no authentication.
 * Used by the Docker HEALTHCHECK directive and external monitoring (Uptime Kuma).
 *
 * Returns:
 *   200 { status: "ok",    db: "ok",          timestamp: ISO string }
 *   503 { status: "error", db: "unreachable",  timestamp: ISO string }
 */
import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method !== "GET") {
    return new Response(null, { status: 405 });
  }

  try {
    // Lightweight DB liveness check — no table scan
    await db.$queryRaw`SELECT 1`;

    return new Response(
      JSON.stringify({
        status: "ok",
        db: "ok",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[/api/health] DB ping failed:", error);
    return new Response(
      JSON.stringify({
        status: "error",
        db: "unreachable",
        timestamp: new Date().toISOString(),
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
};
