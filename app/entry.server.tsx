import { PassThrough } from "stream";
import { renderToPipeableStream } from "react-dom/server";
import { ServerRouter } from "react-router";
import { createReadableStreamFromReadable } from "@react-router/node";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";
import * as Sentry from "@sentry/node";

// ---------------------------------------------------------------------------
// Sentry — initialise only when SENTRY_DSN is provided.
// Graceful: if the env var is absent the app starts normally with no warnings.
// ---------------------------------------------------------------------------
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "production",
    tracesSampleRate: 0.1,
  });
}

// ---------------------------------------------------------------------------
// R2 startup validation — log a clear warning for every missing env var.
// Does NOT throw; uploads will fail with a clear error when they are attempted.
// ---------------------------------------------------------------------------
(function validateR2Config() {
  const required: Record<string, string | undefined> = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
    R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
  };

  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  if (missing.length > 0) {
    console.warn(`[R2] Missing required env vars: ${missing.join(", ")}`);
  }
})();

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext
) {
  const userAgent = request.headers.get("user-agent");
  const callbackName = isbot(userAgent ?? '')
    ? "onAllReady"
    : "onShellReady";

  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
      />,
      {
        [callbackName]: () => {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");
          addDocumentResponseHeaders(request, responseHeaders);

          // Shopify's addDocumentResponseHeaders only sets frame-ancestors CSP when
          // ?shop is present in the request URL. For requests without ?shop (e.g.
          // in-app navigations, OAuth callbacks), set a permissive fallback so the
          // Shopify admin iframe is never blocked by the browser.
          if (!responseHeaders.has('Content-Security-Policy')) {
            responseHeaders.set(
              'Content-Security-Policy',
              "frame-ancestors https://admin.shopify.com https://*.myshopify.com https://*.spin.dev https://admin.myshopify.io https://admin.shop.dev; " +
              "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.shopify.com; " +
              "style-src 'self' 'unsafe-inline' https://cdn.shopify.com; " +
              "img-src 'self' data: https: blob:; connect-src 'self' https://*.myshopify.com https://*.shopify.com;"
            );
          }

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
          pipe(body);
        },
        onShellError(error) {
          reject(error);
        },
        onError(error) {
          responseStatusCode = 500;
          console.error(error);
        },
      }
    );

    // Automatically timeout the React renderer after 6 seconds, which ensures
    // React has enough time to flush down the rejected boundary contents
    setTimeout(abort, streamTimeout + 1000);
  });
}
