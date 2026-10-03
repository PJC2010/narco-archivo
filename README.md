# NarcoHistoria

A public, English-language research archive with owner-only editing. Built with Next.js and Supabase, ready to configure for Vercel. A new database starts empty.

## Development

Use Node.js 22.13+ or 24 and npm.

```sh
npm ci
cp .env.example .env.local
# Set up Supabase and fill in .env.local; see DEPLOYMENT.md.
npm run dev
```

Open http://localhost:3000. The build does not require credentials, but database access, image storage, and owner sign-in require a configured Supabase project.

```sh
npm run typecheck
npm run lint
npm run build
npm test
```

The integration tests run the production build against local test services. They do not connect to your Supabase project or modify production data. Build before running them.

## Deploy

Follow [DEPLOYMENT.md](./DEPLOYMENT.md) to create the Supabase database and private image bucket, provision the owner account, and set the Vercel environment variables. Vercel uses the standard Next.js preset and `npm run build`.

## Use

Open `/manage` and sign in with the owner's Supabase email and password. Create an organization or person, add sources and images, and save a private draft. Publish when ready. Link entries in Relationships: organization/superior, role, evidence status, date range, as-of date, and source. Main boss, lieutenant, plaza boss, faction, and armed-wing roles are supported. Multiple parents are supported; cycles are rejected.

The public archive only exposes published records and images attached to published records. Source library and organization trees update from those entries. Blank relationship dates mean unknown, not current. All content is entered manually; no automated factual or identity verification is claimed.

## Editing and publication

Publishing requires a summary, review date, and source URL. Published relationships need a source and an as-of date. Published images need a caption, identity label, credit, original source URL, and rights note. The editor offers plain-text paragraphs. Published records can be returned to private drafts. Saves use versions to reject conflicting changes. Remove incoming relationships before deleting an entry.

Export downloads records, relationship data, and image metadata as JSON. Image bytes are stored separately in the private Supabase Storage bucket and are not embedded in the export. Removed entries are soft-deleted; there is no user-facing restore flow yet.

## Access and storage

Supabase Auth verifies the owner's session on the server. Only the confirmed user whose email matches `OWNER_EMAIL` can edit, upload, or export. Public registration is not part of the app. The Supabase secret key is only used on the server. Database row-level security is enabled, with no direct table access for anonymous or signed-in clients; the application enforces visibility and owner checks.

Images remain in a private bucket. The image API checks publication or owner access on every request, so returning an entry to draft removes public image access. Keep the bucket private and do not add public access policies.

HTTP writes validate Origin. Sources accept HTTP/HTTPS links only. Uploads accept JPEG, PNG, or WebP up to 4 MB, with file signature checks. The limit leaves room for multipart metadata within Vercel's function request limit.

## Limitations

This is a manually maintained compendium, not a live intelligence feed. The date filter selects recorded relationship periods; an unknown endpoint does not establish that a relationship is active. Single-owner editing is intentional. The current export does not provide full image backup or import/restore. Large datasets may eventually require UI pagination and graph virtualization.

Existing Cloudflare D1 records and R2 image files are not copied automatically. Back up and migrate any existing content before replacing a live Cloudflare deployment; see [the migration notes](./DEPLOYMENT.md#existing-cloudflare-content).
