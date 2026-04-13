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
  // Derive the app URL from the incoming request origin — this is correct regardless
  // of which Cloudflare tunnel is active, avoiding stale SHOPIFY_APP_URL in .env.
  // Falls back to the env var for production deployments where the origin is fixed.
  const appUrl = isAppProxy ? url.origin : null;
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
