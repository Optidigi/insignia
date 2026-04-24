/**
 * Custom production server for Insignia.
 *
 * Replaces `react-router-serve` to add CORS headers on all responses.
 * This is required because the storefront modal is served via the Shopify
 * app proxy at myshopify.com, while assets are fetched directly from
 * insignia.optidigi.nl — a different origin. React Router uses
 * <script type="module"> which requires CORS for cross-origin loading.
 */

import * as Sentry from "@sentry/node";
import compression from "compression";
import { createRequestHandler } from "@react-router/express";
import express from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Sentry — initialise at the Express layer so unhandled errors and uncaught
// rejections that never reach the React Router handler are also captured.
// Graceful: if SENTRY_DSN is absent the app starts normally with no warnings.
// Note: Sentry is also initialised in entry.server.tsx for React Router SSR
// errors. Both instances share the same DSN and deduplicate on the server.
// ---------------------------------------------------------------------------
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0.1,
  });
}

const BUILD_SERVER = pathToFileURL(path.resolve(__dirname, "build/server/index.js")).href;
const CLIENT_DIR = path.resolve(__dirname, "build/client");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(compression());

// CORS headers — required for <script type="module"> loaded cross-origin
// when the Shopify app proxy serves HTML at myshopify.com but assets
// are fetched directly from insignia.optidigi.nl.
// Restricted to Shopify domains only for security.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    origin &&
    (origin.endsWith(".myshopify.com") ||
     origin.endsWith(".shopify.com") ||
     origin === process.env.SHOPIFY_APP_URL)
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Security headers
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  next();
});

// Rate limiting for storefront proxy endpoints.
// These endpoints are public (no Shopify session auth) and directly handle
// slot reservation and file uploads — both prime targets for abuse.
//
// Note: express-rate-limit stores state in-process. For multi-process
// deployments, use a shared store (e.g. redis) to aggregate limits.
// This is acceptable for the current single-instance VPS deployment.
const standardLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { message: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
    });
  },
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({
      error: { message: "Too many upload requests. Please try again later.", code: "RATE_LIMITED" },
    });
  },
});

app.use("/apps/insignia/prepare", standardLimiter);
app.use("/apps/insignia/config", standardLimiter);
app.use("/apps/insignia/upload", uploadLimiter);
app.use("/apps/insignia/price", standardLimiter);
app.use("/apps/insignia/cart-confirm", standardLimiter);
app.use("/apps/insignia/customizations", standardLimiter);
app.use("/apps/insignia/uploads", uploadLimiter);

// Static assets with long-lived cache.
//
// Permissive CORS for /assets — the React Router static JS/CSS bundles
// need to load from ANY merchant's storefront origin, including custom
// domains a merchant may publish on (e.g. stitchs.nl, not just
// *.myshopify.com). Since these bundles are public and carry no
// credentials, `Access-Control-Allow-Origin: *` is safe and scales
// automatically to every future merchant without per-domain config.
// `Vary: Origin` prevents a cached response from one caller masking
// the header for another.
app.use(
  "/assets",
  (_req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.vary("Origin");
    next();
  },
  express.static(path.join(CLIENT_DIR, "assets"), {
    immutable: true,
    maxAge: "1y",
  })
);

// Everything else in build/client (favicon, manifest, etc.).
app.use(express.static(CLIENT_DIR, { maxAge: "1h" }));

// Body size limit — reject oversized requests early.
app.use((req, res, next) => {
  const contentLength = parseInt(req.headers["content-length"] || "0", 10);
  if (contentLength > 6 * 1024 * 1024) {
    return res.status(413).json({
      error: { message: "Request body too large", code: "PAYLOAD_TOO_LARGE" },
    });
  }
  next();
});

// React Router SSR.
app.all(
  "*",
  createRequestHandler({
    build: () => import(BUILD_SERVER),
    mode: process.env.NODE_ENV,
  })
);

// Sentry error handler — must be registered after all routes, before any
// other error-handling middleware. Captures Express-level errors that never
// reach the React Router handler (e.g. middleware crashes, uncaught throws).
if (process.env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
}

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  // Match react-router-serve log format so health checks / logs are unaffected.
  console.log(`[react-router-serve] http://localhost:${port} (http://0.0.0.0:${port})`);
});
