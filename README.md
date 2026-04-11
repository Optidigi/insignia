# Shopify App Template - React Router

This is a template for building a [Shopify app](https://shopify.dev/docs/apps/getting-started) using [React Router](https://reactrouter.com/). It was forked from the [Shopify Remix app template](https://github.com/Shopify/shopify-app-template-remix) and converted to React Router.

Rather than cloning this repo, follow the [Quick Start steps](https://github.com/Shopify/shopify-app-template-react-router#quick-start).

Visit the [`shopify.dev` documentation](https://shopify.dev/docs/api/shopify-app-react-router) for more details on the React Router app package.

## Upgrading from Remix

If you have an existing Remix app that you want to upgrade to React Router, please follow the [upgrade guide](https://github.com/Shopify/shopify-app-template-react-router/wiki/Upgrading-from-Remix). Otherwise, please follow the quick start guide below.

## Quick start

### Prerequisites

Before you begin, you'll need to [download and install the Shopify CLI](https://shopify.dev/docs/apps/tools/cli/getting-started) if you haven't already.

### Setup

```shell
shopify app init --template=https://github.com/Shopify/shopify-app-template-react-router
```

### Local Development

```shell
shopify app dev
```

Press P to open the URL to your app. Once you click install, you can start development.

Local development is powered by [the Shopify CLI](https://shopify.dev/docs/apps/tools/cli). It logs into your account, connects to an app, provides environment variables, updates remote config, creates a tunnel and provides commands to generate extensions.

### Authenticating and querying data

To authenticate and query data you can use the `shopify` const that is exported from `/app/shopify.server.js`:

```js
export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const response = await admin.graphql(`
    {
      products(first: 25) {
        nodes {
          title
          description
        }
      }
    }`);

  const {
    data: {
      products: { nodes },
    },
  } = await response.json();

  return nodes;
}
```

This template comes pre-configured with examples of:

1. Setting up your Shopify app in [/app/shopify.server.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/shopify.server.ts)
2. Querying data using Graphql. Please see: [/app/routes/app.\_index.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/app._index.tsx).
3. Responding to webhooks. Please see [/app/routes/webhooks.tsx](https://github.com/Shopify/shopify-app-template-react-router/blob/main/app/routes/webhooks.app.uninstalled.tsx).

Please read the [documentation for @shopify/shopify-app-react-router](https://shopify.dev/docs/api/shopify-app-react-router) to see what other API's are available.

## App proxy and storefront modal

The storefront customization modal is served via the [App Proxy](https://shopify.dev/docs/apps/build/online-store/app-proxy) at `https://<store>/apps/insignia/*`. The proxy is configured in `shopify.app.toml` under `[app_proxy]` (with `write_app_proxy` scope). For the modal to load, the app URL (and thus the proxy backend) must point at your running app.

### Local development

1. **Start the app** (CLI creates a tunnel and updates the app on your dev store):
   ```bash
   shopify app dev
   ```
   With `[build] automatically_update_urls_on_dev = true` in `shopify.app.toml`, the CLI updates your app URL and redirect URLs on the dev store when you run `dev`. The proxy backend is derived from the app URL (e.g. `https://<tunnel>/apps/insignia`), so you do **not** need to manually set a "Redirect URL" for the app proxy in the dashboard.

2. **Ensure `.env` has `SHOPIFY_APP_URL`** (the CLI usually writes this when the tunnel starts). The storefront modal uses this so script/link tags load from your app.

3. **Test the modal**: On your dev store, open a product that has the Insignia Customize block, click **Customize**, and confirm the modal loads (no "Loading…" and no script 404s).

**If the modal stays on "Loading…" or scripts 404:** The app uses `AppProxyProvider` so script/link tags load from your app URL. Ensure `SHOPIFY_APP_URL` is set (when you run `shopify app dev`, the CLI writes it to `.env`). If you run the app without the CLI (e.g. `npm run dev` only), set `SHOPIFY_APP_URL` in `.env` to your tunnel or app URL.

**If you see "Config failed: 500" or "Query does not contain a signature value"**  
The config endpoint requires a valid App Proxy signature. Open the modal **from the storefront** (go to your dev store → product page that has the Insignia Customize block → click **Customize**). Do not open the modal by visiting the app tunnel URL directly (e.g. `https://your-tunnel.trycloudflare.com/apps/insignia/modal?...`), or the config request will hit your app without going through Shopify’s proxy and will have no signature.

**If you see CORS errors on script files** (e.g. `entry.client.tsx`, `root.tsx` in the Network tab): The modal page is loaded from the store’s origin while scripts are loaded from your app’s origin (tunnel). The Vite dev server is configured to allow cross-origin requests (`server.cors` in `vite.config.ts`). Restart the dev server after changing `vite.config.ts`, and ensure you start the app with `shopify app dev` so the tunnel and `SHOPIFY_APP_URL` are correct.

If you need to change app proxy settings, use **file-based config** in `shopify.app.toml` and run `shopify app deploy` (or let `shopify app dev` apply changes). In the [Dev Dashboard](https://partners.shopify.com), app proxy is under **Apps** → **{your app}** → **Versions** → **Create a version** → **App proxy** (file-based config is recommended).

### Production

1. **Deploy the app** to your host (e.g. Fly.io, Render, Google Cloud Run). Ensure the app is reachable at a public HTTPS URL (e.g. `https://your-app.fly.dev`).

2. **Set environment variables** on the host:
   - `SHOPIFY_APP_URL` = that public URL (e.g. `https://your-app.fly.dev`), no trailing slash.
   - Plus the rest from `.env.example`: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `DATABASE_URL`, R2 vars, etc.
   - `NODE_ENV=production`.

3. **Sync config** so the deployed app URL is used:
   ```bash
   shopify app deploy
   ```
   Deploy pushes your `shopify.app.toml` (including `[app_proxy]`) and updates the app version; the proxy backend will use your production app URL. In Partner Dashboard, confirm **Application URL** (and any redirect URLs) match your production URL; app proxy is configured via the deployed TOML or under **Apps** → **{app}** → **Versions** → **App proxy** if you need to verify.

### "Add block to product page" opens in a new tab

The dashboard uses App Bridge’s Navigation API (`shopify.open(url, '_blank')`) so the theme editor opens in a new tab from the embedded app. The backup “copy this URL” link is a normal anchor with `target="_blank"`. If the button does nothing, ensure the app is loaded inside the Shopify admin iframe (so App Bridge is available). If you see "admin.shopify.com refused to connect," the URL was likely opened inside the iframe; the button and backup link are intended to open in a new tab.

## Shopify Dev MCP

This template is configured with the Shopify Dev MCP. This instructs [Cursor](https://cursor.com/), [GitHub Copilot](https://github.com/features/copilot) and [Claude Code](https://claude.com/product/claude-code) and [Google Gemini CLI](https://github.com/google-gemini/gemini-cli) to use the Shopify Dev MCP.

For more information on the Shopify Dev MCP please read [the documentation](https://shopify.dev/docs/apps/build/devmcp).

## Deployment

### Application Storage

This template uses [Prisma](https://www.prisma.io/) to store session data, by default using an [SQLite](https://www.sqlite.org/index.html) database.
The database is defined as a Prisma schema in `prisma/schema.prisma`.

This use of SQLite works in production if your app runs as a single instance.
The database that works best for you depends on the data your app needs and how it is queried.
Here’s a short list of databases providers that provide a free tier to get started:

| Database   | Type             | Hosters                                                                                                                                                                                                                                    |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MySQL      | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mysql), [Planet Scale](https://planetscale.com/), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/mysql) |
| PostgreSQL | SQL              | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres)                                   |
| Redis      | Key-value        | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-redis), [Amazon MemoryDB](https://aws.amazon.com/memorydb/)                                                                                                        |
| MongoDB    | NoSQL / Document | [Digital Ocean](https://www.digitalocean.com/products/managed-databases-mongodb), [MongoDB Atlas](https://www.mongodb.com/atlas/database)                                                                                                  |

To use one of these, you can use a different [datasource provider](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference#datasource) in your `schema.prisma` file, or a different [SessionStorage adapter package](https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/docs/guides/session-storage.md).

### Build

Build the app by running the command below with the package manager of your choice:

Using yarn:

```shell
yarn build
```

Using npm:

```shell
npm run build
```

Using pnpm:

```shell
pnpm run build
```

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/launch/deployment) to host it externally. From there, you have a few options:

- [Google Cloud Run](https://shopify.dev/docs/apps/launch/deployment/deploy-to-google-cloud-run): This tutorial is written specifically for this example repo, and is compatible with the extended steps included in the subsequent [**Build your app**](tutorial) in the **Getting started** docs. It is the most detailed tutorial for taking a React Router-based Shopify app and deploying it to production. It includes configuring permissions and secrets, setting up a production database, and even hosting your apps behind a load balancer across multiple regions.
- [Fly.io](https://fly.io/docs/js/shopify/): Leverages the Fly.io CLI to quickly launch Shopify apps to a single machine.
- [Render](https://render.com/docs/deploy-shopify-app): This tutorial guides you through using Docker to deploy and install apps on a Dev store.
- [Manual deployment guide](https://shopify.dev/docs/apps/launch/deployment/deploy-to-hosting-service): This resource provides general guidance on the requirements of deployment including environment variables, secrets, and persistent data.

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.

## Gotchas / Troubleshooting

### Database tables don't exist

If you get an error like:

```
The table `main.Session` does not exist in the current database.
```

Create the database for Prisma. Run the `setup` script in `package.json` using `npm`, `yarn` or `pnpm`.

### Navigating/redirecting breaks an embedded app

Embedded apps must maintain the user session, which can be tricky inside an iFrame. To avoid issues:

1. Use `Link` from `react-router` or `@shopify/polaris`. Do not use `<a>`.
2. Use `redirect` returned from `authenticate.admin`. Do not use `redirect` from `react-router`
3. Use `useSubmit` from `react-router`.

This only applies if your app is embedded, which it will be by default.

### Webhooks: shop-specific webhook subscriptions aren't updated

If you are registering webhooks in the `afterAuth` hook, using `shopify.registerWebhooks`, you may find that your subscriptions aren't being updated.

Instead of using the `afterAuth` hook declare app-specific webhooks in the `shopify.app.toml` file. This approach is easier since Shopify will automatically sync changes every time you run `deploy` (e.g: `npm run deploy`). Please read these guides to understand more:

1. [app-specific vs shop-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions)
2. [Create a subscription tutorial](https://shopify.dev/docs/apps/build/webhooks/subscribe/get-started?deliveryMethod=https)

If you do need shop-specific webhooks, keep in mind that the package calls `afterAuth` in 2 scenarios:

- After installing the app
- When an access token expires

During normal development, the app won't need to re-authenticate most of the time, so shop-specific subscriptions aren't updated. To force your app to update the subscriptions, uninstall and reinstall the app. Revisiting the app will call the `afterAuth` hook.

### Webhooks: Admin created webhook failing HMAC validation

Webhooks subscriptions created in the [Shopify admin](https://help.shopify.com/en/manual/orders/notifications/webhooks) will fail HMAC validation. This is because the webhook payload is not signed with your app's secret key.

The recommended solution is to use [app-specific webhooks](https://shopify.dev/docs/apps/build/webhooks/subscribe#app-specific-subscriptions) defined in your toml file instead. Test your webhooks by triggering events manually in the Shopify admin(e.g. Updating the product title to trigger a `PRODUCTS_UPDATE`).

### Webhooks: Admin object undefined on webhook events triggered by the CLI

When you trigger a webhook event using the Shopify CLI, the `admin` object will be `undefined`. This is because the CLI triggers an event with a valid, but non-existent, shop. The `admin` object is only available when the webhook is triggered by a shop that has installed the app. This is expected.

Webhooks triggered by the CLI are intended for initial experimentation testing of your webhook configuration. For more information on how to test your webhooks, see the [Shopify CLI documentation](https://shopify.dev/docs/apps/tools/cli/commands#webhook-trigger).

### Incorrect GraphQL Hints

By default the [graphql.vscode-graphql](https://marketplace.visualstudio.com/items?itemName=GraphQL.vscode-graphql) extension for will assume that GraphQL queries or mutations are for the [Shopify Admin API](https://shopify.dev/docs/api/admin). This is a sensible default, but it may not be true if:

1. You use another Shopify API such as the storefront API.
2. You use a third party GraphQL API.

If so, please update [.graphqlrc.ts](https://github.com/Shopify/shopify-app-template-react-router/blob/main/.graphqlrc.ts).

### Using Defer & await for streaming responses

By default the CLI uses a cloudflare tunnel. Unfortunately cloudflare tunnels wait for the Response stream to finish, then sends one chunk. This will not affect production.

To test [streaming using await](https://reactrouter.com/api/components/Await#await) during local development we recommend [localhost based development](https://shopify.dev/docs/apps/build/cli-for-apps/networking-options#localhost-based-development).

### "nbf" claim timestamp check failed

This is because a JWT token is expired. If you are consistently getting this error, it could be that the clock on your machine is not in sync with the server. To fix this ensure you have enabled "Set time and date automatically" in the "Date and Time" settings on your computer.

### Using MongoDB and Prisma

If you choose to use MongoDB with Prisma, there are some gotchas in Prisma's MongoDB support to be aware of. Please see the [Prisma SessionStorage README](https://www.npmjs.com/package/@shopify/shopify-app-session-storage-prisma#mongodb).

### Unable to require(`C:\...\query_engine-windows.dll.node`).

Unable to require(`C:\...\query_engine-windows.dll.node`).
The Prisma engines do not seem to be compatible with your system.

query_engine-windows.dll.node is not a valid Win32 application.

**Fix:** Set the environment variable:

```shell
PRISMA_CLIENT_ENGINE_TYPE=binary
```

This forces Prisma to use the binary engine mode, which runs the query engine as a separate process and can work via emulation on Windows ARM64.

## Resources

React Router:

- [React Router docs](https://reactrouter.com/home)

Shopify:

- [Intro to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [Shopify App React Router docs](https://shopify.dev/docs/api/shopify-app-react-router)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify App Bridge](https://shopify.dev/docs/api/app-bridge-library).
- [Polaris Web Components](https://shopify.dev/docs/api/app-home/polaris-web-components).
- [App extensions](https://shopify.dev/docs/apps/app-extensions/list)
- [Shopify Functions](https://shopify.dev/docs/api/functions)

Internationalization:

- [Internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)
