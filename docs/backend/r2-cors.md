# R2 CORS for browser uploads

Direct browser uploads to R2 (via presigned PUT URLs) are cross-origin. The browser sends an **OPTIONS** preflight; if the bucket has no CORS policy, R2 returns **403 Forbidden** and the upload fails.

## Fix: add a CORS policy on the bucket

1. In the **Cloudflare dashboard** go to **R2** → your bucket (e.g. `insignia-bucket`) → **Settings**.
2. Under **CORS Policy**, click **Add CORS policy**.
3. Use the **JSON** tab and paste a policy that allows your app origin and PUT with `Content-Type`.

### Development (tunnel URL)

Use your current app origin (no path). Example for a Cloudflare tunnel:

```json
[
  {
    "AllowedOrigins": ["https://YOUR-TUNNEL-SUBDOMAIN.trycloudflare.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Replace `YOUR-TUNNEL-SUBDOMAIN` with your actual tunnel host (e.g. `announce-fifty-charter-trackbacks`). If you use a new tunnel URL later, add it to `AllowedOrigins` or create another rule.

### Production

Use your production app origin(s):

```json
[
  {
    "AllowedOrigins": ["https://your-app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

4. Save. CORS changes can take up to ~30 seconds to apply.

## Verify

- Reload the app and upload an image again.
- In DevTools → Network, the **OPTIONS** request to the R2 host should return **200** with `Access-Control-Allow-Origin` and related headers, then the **PUT** should succeed.

## Reference

- [Cloudflare R2: Configure CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Use CORS with a presigned URL](https://developers.cloudflare.com/r2/buckets/cors/#use-cors-with-a-presigned-url)
