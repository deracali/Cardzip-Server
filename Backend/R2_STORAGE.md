# Private R2 storage for digital product files

Admin-uploaded product ZIP archives and buyer/legal documents upload to Cloudinary first, then mirror to private Cloudflare R2 when R2 is configured. Product images and seller-submitted assets continue using their existing storage.

## Configure

1. Create a **private** R2 bucket in Cloudflare.
2. Create an R2 API token/key scoped to that bucket with object read/write permissions.
3. Configure these environment variables for the backend and restart it:

```env
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=
```

Keep the bucket private and do not expose these values to the admin or buyer frontend. The backend stores private `r2://` object references alongside Cloudinary fallback URLs and serves paid downloads from R2 first. If R2 is unavailable, the backend falls back to Cloudinary. Downloads are streamed only after checking the matching completed payment. If R2 is not configured or its mirror upload fails, the Cloudinary upload remains usable.
