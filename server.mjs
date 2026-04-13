/**
 * Custom production server for Insignia.
 *
 * Replaces `react-router-serve` to add CORS headers on all responses.
 * This is required because the storefront modal is served via the Shopify
 * app proxy at myshopify.com, while assets are fetched directly from
 * insignia.optidigi.nl — a different origin. React Router uses
 * <script type="module"> which requires CORS for cross-origin loading.
 */

import { createRequestHandler } from "@react-router/express";
import express from "express";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BUILD_SERVER = path.resolve(__dirname, "build/server/index.js");
const CLIENT_DIR = path.resolve(__dirname, "build/client");

const app = express();
app.disable("x-powered-by");

// CORS headers — required for <script type="module"> loaded cross-origin
// when the Shopify app proxy serves HTML at myshopify.com but assets
// are fetched directly from insignia.optidigi.nl.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  next();
});

// Rate limiting for storefront proxy endpoints.
// These endpoints are public (no Shopify session auth) and directly handle
// slot reservation and file uploads — both prime targets for abuse.
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

// Static assets with long-lived cache.
app.use(
  "/assets",
  express.static(path.join(CLIENT_DIR, "assets"), {
    immutable: true,
    maxAge: "1y",
  })
);

// Everything else in build/client (favicon, manifest, etc.).
app.use(express.static(CLIENT_DIR, { maxAge: "1h" }));

// React Router SSR.
app.all(
  "*",
  createRequestHandler({
    build: () => import(BUILD_SERVER),
    mode: process.env.NODE_ENV,
  })
);

const port = Number(process.env.PORT || 3000);
app.listen(port, () => {
  // Match react-router-serve log format so health checks / logs are unaffected.
  console.log(`[react-router-serve] http://localhost:${port} (http://0.0.0.0:${port})`);
});
