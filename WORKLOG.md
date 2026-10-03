# Vercel migration — 2026-10-03

- Replaced the Cloudflare/Vinext build with standard Next.js development, production build, and server commands.
- Removed unused Sites authentication, connector scaffolding, Wrangler configuration, and D1 migrations.
- Added server-side Supabase Auth with a confirmed owner email allowlist, secure session cookies, refresh handling, and same-origin POST sign-in/sign-out.
- Added a PostgreSQL migration with a private archive table and service-only mutation functions. Saves and deletes serialize relationship and version checks with their writes.
- Moved image storage to a private Supabase bucket; image responses recheck owner/publication access and disable caching. Uploads are limited to 4 MB for Vercel.
- Preserved the archive interface, draft/publication validation, relationships, optimistic save conflicts, and JSON export.
- Added environment templates and Vercel/Supabase setup instructions in DEPLOYMENT.md.

## Verification

- `npm run build`: passed with no Supabase credentials; standard Next.js output includes all API, authentication, and workspace routes.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: passed against the final production build on 127.0.0.1.
- Verified public/login page rendering, password sign-in, confirmed-owner checks, spoofed-header rejection, same-origin enforcement, session expiry and refresh-cookie propagation, revoked sessions, and logout during an Auth outage.
- Verified actual SQL grants and mutations, private drafts, publishing/unpublishing, private/public image access, invalid/oversized uploads, conflicting saves, cycle/missing-parent rejection, linked deletion protection, soft deletion, and exports beyond 1,000 entries.
- `git diff --check`: passed.

Integration tests use the actual PostgreSQL migration with PGlite and a local Supabase-compatible HTTP service. Auth and object storage are test doubles; these checks do not establish live Supabase/Vercel deployment readiness.

## External setup

No Supabase or Vercel project credentials were provided in this workspace. Deployment requires applying the SQL migration, provisioning the owner, and setting the documented environment variables. Existing Cloudflare records/images are not automatically transferred.
