# NarcoHistoria
A public, English-language research archive with owner-only editing. The archive starts empty.

## Use
Open `/manage` and sign in with the owner ChatGPT account. Create an organization or person, add sources and images, and save a private draft. Publish when ready. Link entries in Relationships: organization/superior, role, evidence status, date range, as-of date and source. Main boss, lieutenant, plaza boss, faction and armed-wing roles are supported. Multiple parents are supported; cycles are rejected.

The public archive only exposes published records and images attached to published records. Source library and organization trees update from those entries. Blank relationship dates mean unknown, not current. All content is entered manually; no automated factual or identity verification is claimed.

## Editing and publication
Publishing requires a summary, review date and source URL. Published relationships need a source and an as-of date. Published images need a caption, identity label, credit, original source URL and rights note. The editor offers plain-text paragraphs. Published records can be returned to private drafts. Saves use versions to reject conflicting changes. Remove incoming relationships before deleting an entry.

Export downloads records, relationship data and image metadata as JSON; image bytes are stored separately in R2 and are not embedded in the export. Removed entries are soft-deleted; there is no user-facing restore flow yet.

## Development
`npm install`, `npm run db:generate`, `npm run dev`.
`npx tsc --noEmit` checks types; `npm run build` builds for Cloudflare Workers.

Persistent D1 database binding: `DB`; persistent R2 images: `BUCKET`. Schema changes use generated Drizzle migrations. Production deployment applies migrations; local preview needs each pending SQL applied once with Wrangler (`--persist-to .wrangler/state`). See the commands in WORKLOG.md.

Production `OWNER_EMAIL` is configured privately in Sites and checked server-side against authenticated platform headers for every mutation. It fails closed when unset. The local `.env` uses only the starter's preview account. Never use that test account as production owner. Sites dispatch handles sign-in; never implement a client-only authorization check.

HTTP writes also validate Origin. Sources accept HTTP/HTTPS links only. Uploads accept JPEG/PNG/WebP up to 5 MB, with file signature checks. Draft images are served only to the owner. No API keys or owner identity are bundled into client code.

## Limitations
This is a manually maintained compendium, not a live intelligence feed. The date filter selects recorded relationship periods; an unknown endpoint does not establish that a relationship is active. Single-owner editing is intentional. The current export does not provide full image backup or import/restore. Very large datasets may eventually require pagination and graph virtualization.
