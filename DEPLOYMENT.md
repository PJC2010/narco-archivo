# Deploy on Vercel with Supabase

## 1. Create the Supabase project

Create a Supabase project. In its SQL Editor, run [`20261003000000_archive.sql`](./supabase/migrations/20261003000000_archive.sql). This creates the archive table, database functions, and private `archive-images` bucket. For later updates, apply new migrations in filename order. Application builds do not modify the database.

Use a dedicated project, or review the migration before applying it to a shared project. Keep the image bucket private. No anonymous or authenticated client policies are needed: the server verifies the session, then performs authorized work using its secret key.

## 2. Create the owner account

In Supabase **Authentication → Users**, add the owner's user with an email and a strong password. Mark the email confirmed when creating the account. In the email provider settings, keep email/password sign-in enabled and disable new user signups.

The email must match `OWNER_EMAIL`. The app has no registration flow and allows only that confirmed user to edit. Use `/login` or `/manage` to sign in. Password recovery can be managed through the Supabase dashboard; a self-service recovery screen is not included.

## 3. Set environment variables

Copy the project URL and API keys from Supabase project settings. Use the same Supabase project for all three values.

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | The project's HTTPS API URL |
| `SUPABASE_PUBLISHABLE_KEY` | The project's publishable API key |
| `SUPABASE_SECRET_KEY` | The project's secret API key; server use only |
| `OWNER_EMAIL` | The confirmed owner's email |
| `SUPABASE_STORAGE_BUCKET` | `archive-images` |

Legacy Supabase projects may use `SUPABASE_ANON_KEY` instead of the publishable key and `SUPABASE_SERVICE_ROLE_KEY` instead of the secret key. Never expose a secret/service-role key in browser code, Git, screenshots, or a `NEXT_PUBLIC_` variable.

For local development, put these values in the ignored `.env.local` file using `.env.example` as a guide. Do not commit real credentials.

## 4. Import the repository into Vercel

1. Push the migration changes to your GitHub repository and import that repository in Vercel.
2. Select the **Next.js** framework preset and the repository root as the project root. `vercel.json` also declares the preset.
3. Use Node.js **22.x** or **24.x**. Keep the standard install/build settings: `npm ci` and `npm run build`. Leave the output directory at the Next.js default.
4. Add the environment variables above to the Production environment, then deploy.
5. For Preview deployments, use a separate Supabase test project and owner account. Giving previews production keys gives that deployed code access to production data.

No Cloudflare account, D1/R2 binding, Wrangler build, or Sites sign-in endpoint is needed. No OAuth callback URL is needed for the email/password flow.

Changing Vercel environment variables requires a new deployment. Keep database migrations and app code in sync.

## 5. Verify the deployment

- Open the public archive in a signed-out browser. A new project should show an empty archive.
- Sign in at `/manage` with the confirmed owner account and save a draft.
- Check in a signed-out browser that the draft and its images are inaccessible.
- Add the required sources and image provenance, then publish. Verify the entry appears publicly.
- Return it to draft and verify its images are no longer available publicly.
- Sign out and confirm the workspace requires sign-in again.

Uploads accept JPEG/PNG/WebP up to **4 MB**. The server validates file signatures and serves images through the application, preserving private-draft access controls. The bucket must not be made public.

## Existing Cloudflare content

This migration changes application code and creates an empty Supabase schema. It does not reach into an existing deployment to transfer data.

Before switching an existing public domain, export archive records from the old owner workspace and back up the R2 bucket separately. The JSON export contains image metadata, not image bytes. Preserve entry IDs, relationship IDs, versions, and image object keys when transferring records and files. Copy the R2 objects into the private Supabase bucket using the same keys. Database rows use a JSONB `payload` plus matching `id`, `status`, `version`, `deleted`, and `updated_at` columns. For a full migration including soft-deleted records, use a D1 database export, since the owner export only contains active entries.

The app does not include a bulk import tool. Keep the old deployment and backups until the transferred records and private/public access have been checked. Existing images over the new 4 MB limit should be resized and their references updated before transfer.

## Local verification

```sh
npm ci
npm run typecheck
npm run lint
npm run build
npm test
```

The automated integration tests use a temporary local Supabase-compatible test service and an embedded PostgreSQL engine. They exercise the real production app and SQL migration without requiring Supabase credentials. A real deployed Supabase/Vercel check remains necessary after configuring the accounts.
