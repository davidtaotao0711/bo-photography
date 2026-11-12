# Migrate public images to Cloudflare R2

This procedure keeps the existing `/images/...` paths. `public/images` remains the source library used by Astro dev, the local Editor, and the responsive image generator. The R2 upload set matches the default build's image set, including originals and current responsive variants.

## Configure the upload

Use a Standard R2 bucket named `bo-public-images`. Create an R2 S3 API token with **Object Read & Write** scoped to this bucket. Put its credentials in the Git-ignored `.env.local` at the repository root. Node.js 20.12 or later is required by the upload script.

```dotenv
R2_ACCOUNT_ID=
R2_BUCKET_NAME=bo-public-images
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
PUBLIC_IMAGE_BASE_URL=
```

Use an HTTPS public bucket URL for `PUBLIC_IMAGE_BASE_URL`, with no final `/images` segment. The script and the site append the full object key. R2's `r2.dev` URL is suitable for the sample. Use an R2 custom domain for production. Keep the S3 credentials local. Vercel only needs the public base URL.

```sh
npm ci
npm run images:r2 -- --dry-run
npm run images:r2 -- --upload --verify-public --key images/about-portrait.jpg --key images/generated/home__cover-1600.webp --key images/grain.png
```

Run the sample command twice. The second run should report `skipped` for all three files after checking the signed object and comparing the bytes served by the public URL. Uploads use conditional creates, bounded retries, and a checksum. A key containing different bytes or a different MIME type is reported as a conflict. Review it before continuing. Fix any errors and rerun the same command to resume. The script never overwrites an existing key.

## Upload and verify the full library

Use the production public origin in `.env.local` for the full verification.

```sh
npm run images:r2 -- --upload
npm run images:r2 -- --verify --verify-public
```

Full public verification reads every image and hashes its bytes, so expect a download of roughly the size shown by the dry-run. Resolve any failures before enabling the Vercel environment variable. Repeat upload and verification after adding images and before deploying changes that reference them.

## Preview and cut over

1. Deploy a Vercel Preview with `PUBLIC_IMAGE_BASE_URL` set in the **Preview** environment only. The production environment should still omit the variable.
2. Confirm the build output has no `dist/images` directory. The Vercel configuration should forward `/images/:path*` to the configured origin under the same key. Preview the desktop and mobile Home hero, Portfolio thumbnails and Lightbox originals, Series, Portrait Books, CSS grain, and the Editor image previews. Also verify a direct `/images/...` link and that the local Editor can still read files in Astro dev.
3. After the preview checks pass, set the same public base URL in the Vercel **Production** environment and deploy. Verify the production image requests and compare Vercel Deployment Storage over subsequent billing days.
4. To restore local image delivery, roll back to the last production deployment that packaged its images, then unset `PUBLIC_IMAGE_BASE_URL` for Production before rebuilding. Keep the local source library and the known-good deployment available during the transition.

[R2 S3 setup](https://developers.cloudflare.com/r2/get-started/s3/) · [R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/) · [Vercel external rewrites](https://vercel.com/docs/routing/rewrites#rewrites-to-external-origins)
