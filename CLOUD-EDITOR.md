# Cloud-first Editor

The catalog indexes each photograph by the SHA-256 of the original bytes. Paths remain aliases, so deduplication never changes the published URL, photo ID, or position of an existing placement. The initial bo-photography seed has 445 photographs. It excludes the site grain and sharing graphic.

## Storage and data model

- The public R2 bucket continues to serve existing image URLs and new WebP renditions, including the smaller sizes used by galleries. New uploads never write a raw original to this bucket. The longest public edge is 2,000 px.
- A different, private R2 bucket stores AES-GCM-encrypted originals and encrypted upload chunks. Leave both the public development URL and custom domains disabled on this bucket. Scope the S3 credentials to this bucket. A missing private bucket configuration stops new uploads before any chunks are written.
- D1 holds the hash, canonical display path, thumbnail, dimensions, original filename, user-managed tags, creation time, and legacy aliases. The Editor registers the record after R2 confirms the upload. Retry repairs registration if the asset was already stored. No photo bytes or decryption keys enter D1.
- The existing encrypted R2 snapshot remains authoritative for works, categories, Series, book spreads, and ordering. Library filters derive membership from this snapshot. Existing IDs, layout references and compare-and-set saves remain in use. Normalizing placements into D1 would require moving all writers together or coordinating versioned writes across stores. The catalog does not require that cutover.

## Rollout

1. Create a D1 database and private R2 bucket in the existing Cloudflare account. Add `BO_D1_DATABASE_ID`, `BO_D1_API_TOKEN`, `BO_PRIVATE_R2_BUCKET_NAME`, `BO_PRIVATE_R2_ACCESS_KEY_ID`, and `BO_PRIVATE_R2_SECRET_ACCESS_KEY` to the server environments. Use an account-scoped Cloudflare token with D1 write access and separate, bucket-scoped R2 credentials. The local `.env.local` and Vercel Production must point to the same D1 and buckets. Keep preview editing isolated from production saves and uploads.
2. Run `node --env-file=.env.local scripts/seed-editor-catalog.mjs`. The seed is repeatable, preserves tags, and reads completed upload descriptors from R2. Compare its results with the actual bucket. The old public bucket must have no raw `images/editor/.../original.*` files, encrypted `editor-originals/` archives or active staging sessions before switching uploads. If any exist, verify private copies and old URL compatibility before removing public access.
3. For Zine, first use `node --env-file=.env.local scripts/import-zine-catalog.mjs --dry-run <zine-checkout>`. Once both buckets and D1 are configured, `--apply` imports the library through the same image processing and registration. It keeps the source files and existing Zine project references. The separate Zine app still needs to use this catalog for its picker and uploads before decommissioning its Unassigned source.
4. Verify upload, search, filters, tags, pagination, duplicates, reuse in a category and a Series, adding to a Portrait Book, then save, refresh and reopen. Confirm the exact raw original key returns no object anonymously on public image routes and the authenticated private bucket can read the archive. Run `npm run build` with the configured image origin and confirm the output excludes local images.

When D1 is absent, the catalog can browse the committed legacy index and completed R2 upload descriptors. It does not read local photo directories or expose tag editing in that mode. D1 is preferred for normal operation because listing and downloading every descriptor on each browse grows with the library.
