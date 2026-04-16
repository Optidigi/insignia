import type { LoaderFunctionArgs } from "react-router";
import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
} from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const isAppProxy = url.pathname.startsWith("/apps/");
  // Derive the app URL from the incoming request origin. When behind a Cloudflare
  // tunnel (dev) or reverse proxy (prod), TLS is terminated upstream so request.url
  // arrives as http://. X-Forwarded-Proto carries the original scheme.
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() ?? url.protocol.replace(":", "");
  const origin = proto === "https" ? url.origin.replace(/^http:/, "https:") : url.origin;
  const appUrl = isAppProxy ? origin : null;
  return { appUrl };
};

export default function App() {
  const { appUrl } = useLoaderData<typeof loader>();
  return (
    <html lang="en">
      <head>
        {appUrl && <base href={appUrl + "/"} />}
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
