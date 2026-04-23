import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, isRouteErrorResponse, Link } from "react-router";
import { forwardRef } from "react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { AppProvider as PolarisAppProvider, Box } from "@shopify/polaris";
import "@shopify/polaris/build/esm/styles.css";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const sessionTokenForApi =
    url.searchParams.get("id_token") ||
    request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ||
    "";

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", sessionTokenForApi };
};

// Regex to detect external links (protocol-based or protocol-relative URLs)
const IS_EXTERNAL_LINK_REGEX = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

// Custom link component that integrates Polaris with React Router
// Based on Polaris documentation pattern for linkComponent
const AppBridgeLink = forwardRef<
  HTMLAnchorElement,
  {
    url: string;
    children?: React.ReactNode;
    external?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }
>(function AppBridgeLink({ url = "", children, external, ...rest }, ref) {
  // External links or absolute URLs should use regular anchor tags
  if (external || IS_EXTERNAL_LINK_REGEX.test(url)) {
    return (
      <a
        href={url}
        ref={ref}
        target="_blank"
        rel="noopener noreferrer"
        {...rest}
      >
        {children}
      </a>
    );
  }

  // Internal links use React Router's Link for client-side navigation
  // This keeps navigation within the embedded app context
  return (
    <Link to={url} ref={ref} {...rest}>
      {children}
    </Link>
  );
});

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations} linkComponent={AppBridgeLink}>
        <NavMenu>
          <Link to="/app" rel="home">Home</Link>
          <Link to="/app/methods">Decoration methods</Link>
          <Link to="/app/products">Products</Link>
          <Link to="/app/orders">Orders</Link>
          <Link to="/app/settings">Settings</Link>
        </NavMenu>
        <Box paddingBlockEnd="1600">
          <Outlet />
        </Box>
      </PolarisAppProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && typeof error.data !== "string") {
    const data = error.data as { error?: { message?: string } } | null;
    const message = data?.error?.message ?? "An unexpected error occurred.";
    // Object.assign + Object.create is required (not stylistic):
    // boundary.error gates on constructor.name === 'ErrorResponseImpl'.
    // A plain object spread { ...error } would produce constructor.name === 'Object'
    // and cause boundary.error to re-throw instead of render.
    const patched = Object.assign(
      Object.create(Object.getPrototypeOf(error)) as typeof error,
      error,
      { data: message },
    );
    return boundary.error(patched);
  }
  return boundary.error(error);
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
