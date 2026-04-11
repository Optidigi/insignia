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
  const appUrl = isAppProxy
    ? (process.env.SHOPIFY_APP_URL ?? "").replace(/\/$/, "")
    : null;
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
