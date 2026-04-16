/**
 * App Proxy Layout Route
 *
 * Thin parent layout for all /apps/insignia/* routes.
 *
 * Deliberately does NOT call authenticate.public.appProxy here, because:
 *  - UI routes (modal) authenticate in their own loaders and wrap with AppProxyProvider.
 *  - Resource routes (config, prepare, uploads, …) authenticate in their own loaders.
 * Putting auth here caused every API request to authenticate twice and made
 * the ErrorBoundary fire for JSON routes, which React cannot render as HTML.
 *
 * The ErrorBoundary here handles HTML rendering failures (e.g. the modal loader
 * throwing before the component tree is built). It MUST return JSX — returning a
 * Response from an ErrorBoundary on a UI layout route causes
 * "Objects are not valid as a React child (found: [object Response])".
 */

import { Outlet, useRouteError } from "react-router";

export const loader = async () => {
  return {};
};

export default function AppsInsigniaLayout() {
  return <Outlet />;
}

export function ErrorBoundary() {
  const error = useRouteError();
  // In production, never expose raw error messages to storefront customers — they
  // could contain internal DB query details, service names, or stack traces.
  const message =
    process.env.NODE_ENV === "production"
      ? "An unexpected error occurred."
      : error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "An unexpected error occurred.";

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Error — Insignia</title>
      </head>
      <body style={{ fontFamily: "sans-serif", padding: "2rem", color: "#111" }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
        <p style={{ color: "#555" }}>{message}</p>
      </body>
    </html>
  );
}
