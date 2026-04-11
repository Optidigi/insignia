# Run the app and test on your dev store

Use this when you want to see the app live in your test store.

## Prerequisites

- **Node.js** (v20.19+ or v22.12+)
- **Shopify CLI** installed: `npm install -g @shopify/cli @shopify/app`
- **Shopify Partner account** and a **development store** (create one in [Partners](https://partners.shopify.com) → your app → Development stores)

---

## Steps

### 1. Open the project and install dependencies

```bash
cd /Users/pc/Development/GitHub/Insignia-shopify-app
npm install
```

### 2. Connect the app to your Partner app (if needed)

If this repo isn’t linked yet:

```bash
shopify app config link
```

Pick your **Insignia** app (or create one from this folder). When asked, choose your **development store**.

### 3. Set up the database

```bash
npx prisma generate
npx prisma migrate deploy
```

(Uses SQLite by default; `dev` will use the same DB.)

### 4. Start the app (tunnel + dev store)

```bash
shopify app dev
```

This will:

- Start the local server
- Create a **tunnel** (e.g. Cloudflare) so Shopify can reach your machine
- Update your app’s URLs on the **dev store** to point at the tunnel
- Write `SHOPIFY_APP_URL` (and other vars) into `.env`

When it’s ready it will say something like: **“Press p to open the URL”**.

### 5. Open the app in the admin

- In the terminal, press **`p`** to open the app URL in the browser, or  
- In your **development store** admin: **Apps** → open **Insignia** (install if prompted).

You should see the app (dashboard, Methods, Product configurations, etc.) inside the admin.

### 6. Test the storefront modal

1. In the app, create at least one **decoration method** and one **product configuration** linked to a product.
2. Add the **Insignia Customize** block to the product page:  
   In the admin go to **Online Store** → **Themes** → **Customize** → open a **product** template → add block **Apps** → **Insignia Customize**.
3. On the **storefront**, open that product and click **Customize**.  
   The modal should load (open the modal from the store, not by pasting the tunnel URL).

---

## If something fails

| Problem | What to do |
|--------|------------|
| “No app found” / config link fails | Run `shopify app config link` and select or create the app; ensure you’re logged in (`shopify auth login`). |
| Database errors | Run `npx prisma generate` and `npx prisma migrate deploy`. |
| Tunnel / URL errors | Let `shopify app dev` run until the tunnel is ready; don’t run `npm run dev` alone. |
| Modal “Config failed” or no signature | Open the modal from the **storefront** (product page → Customize), not by opening the tunnel URL in a new tab. |

---

## Quick reference

```bash
# One-time (or after pull): install + DB
npm install && npx prisma generate && npx prisma migrate deploy

# Every time you want to test
shopify app dev
# then press p to open the app
```
