# Profolio

Taking the portfolio and creating a digital, universal professional evidence vault + showcase platform designed for professionals such as teachers, nurses and graphic designers.

**Current state: MVP.** Two areas:

1. **Portfolio builder** (`/portfolio`) — industry-neutral and functional. Upload documents, organise them into nested folders, and export the whole portfolio as one PDF with a cover page, contents page and page numbers. Documents are stored in Cloudflare R2, metadata in D1, behind Cloudflare Access.
2. **Teaching portfolio** (`/sequence`, `/evidence`, `/standards`, `/present`) — a worked example: a five-week teaching sequence mapped to the Australian Professional Standards for Teachers (APST). Authored content read from JSON at build time.

Access is an **allowlist**, not public sign-up: only email addresses you add to
the Access policy can sign in, and each signed-in identity owns its own rows.

## Architecture

| Concern | Where it lives |
| --- | --- |
| Document bytes | Cloudflare R2 (`DOCUMENTS` binding), keyed `<owner-email>/<uuid>` |
| Document/folder metadata | Cloudflare D1 (`DB` binding) |
| Authentication | Cloudflare Access (Zero Trust), JWT verified in the Worker |
| Content pages | Prerendered HTML served from the edge — no Worker invocation |
| PDF assembly | The browser. Bytes stream down from R2 one document at a time |

Only `/api/*` runs on the Worker (`export const prerender = false`). Everything else is static.

## Cloudflare setup

### 1. Provision the resources

```bash
npx wrangler login
npx wrangler r2 bucket create profolio-documents
npx wrangler d1 create profolio
```

Put the `database_id` printed by the last command into `wrangler.jsonc`.

Note: R2 requires a payment method on the account even to use the free tier (10 GB storage, 1M writes, 10M reads per month, **free egress**). D1's free tier is 500 MB per database and 5 GB per account, with daily caps of 5M rows read and 100K rows written — Cloudflare began enforcing those daily caps on 1 September 2026.

### 2. Create the tables

```bash
npm run db:migrate:remote
```

### 3. Put Cloudflare Access in front of the app

In the Cloudflare dashboard, under **Zero Trust → Access → Applications**, add a
self-hosted application:

- **Domain**: your Worker's hostname, with path `/` (covering `/api/*` too).
- **Policy**: Allow → Emails → the addresses you want to let in.
- After saving, open the application's **Overview** tab and copy the
  **Application Audience (AUD) tag**.

Then set both variables in `wrangler.jsonc` (or as Worker settings):

```jsonc
"vars": {
  "ACCESS_TEAM_DOMAIN": "yourteam.cloudflareaccess.com",
  "ACCESS_AUD": "<the AUD tag>"
}
```

**Both must be set.** With either missing, every `/api` route returns 503 rather
than serving unauthenticated — see `src/lib/server/access.ts`.

### 4. Point the build at the right config

The Astro adapter writes a deploy-ready config to `dist/server/wrangler.json`.
A bare `wrangler deploy` against the root config fails with *"Missing
entry-point"*, so the deploy command must be:

```
npx wrangler deploy -c dist/server/wrangler.json
```

In **Workers Builds**, set:

| Field | Value |
| --- | --- |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy -c dist/server/wrangler.json` |
| Version command | `npx wrangler versions upload -c dist/server/wrangler.json` |
| Root directory | `/` |

## How authentication is enforced

Cloudflare Access adds a signed JWT to every request it lets through.
`src/lib/server/access.ts` verifies:

- the RS256 signature, against the team's published keys (cached for an hour);
- the issuer matches `https://<team domain>`;
- the audience contains your application's AUD tag;
- `exp` / `nbf`.

The `Cf-Access-Authenticated-User-Email` header is **not** trusted on its own —
a Worker is reachable on its `workers.dev` hostname where no Access policy
applies, and any client can set that header. The verified `email` claim becomes
the `owner` column on every row, and every query filters on it.

Astro's CSRF origin check is also active, which matters because Access
authenticates with a cookie: a cross-origin `POST`/`DELETE` is rejected with 403.

## Running locally

Local development uses Miniflare's D1 and R2 emulation — no Cloudflare account
needed, and nothing touches your real bucket:

```bash
npm install
npm run db:migrate:local   # once, to create the tables
npm run dev:worker         # builds, then serves on http://localhost:8787
```

`dev:worker` passes `--var ACCESS_DEV_BYPASS:true`, which skips JWT
verification and signs you in as `dev@localhost`. That flag is passed on the
command line only — it is deliberately **not** in `wrangler.jsonc`, so it cannot
reach production.

`npm run dev` still runs the plain Astro dev server, which is fine for the
static pages but has no bindings, so `/portfolio` will not load data.

## Running locally

Requires Node 18.20.8+, 20.3.0+ or 22+ (this project is developed on Node 22).

```bash
npm install
npm run dev      # http://localhost:4321
```

Other scripts:

| Command           | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run build`          | Builds to `./dist` (`client/` assets + `server/` Worker) |
| `npm run dev:worker`     | Build, then run the Worker locally with local D1 + R2    |
| `npm run db:migrate:local`  | Create the tables in the local emulated D1            |
| `npm run db:migrate:remote` | Create the tables in the real D1                     |
| `npm run deploy`         | Deploy via the adapter-generated config                  |
| `npm run check`          | `astro check` (TypeScript + template diagnostics)        |

## Routes

| Route               | Module                                                        |
| ------------------- | ------------------------------------------------------------- |
| `/`                 | Home — entry point for both areas                               |
| `/portfolio`        | **Portfolio builder** — upload, folders, PDF export (functional) |
| `/sequence`         | Teaching sequence index                                        |
| `/sequence/[week]`  | One week (Weeks 1–5, generated from `src/data/sequence.json`)   |
| `/evidence`         | Evidence upload UI (placeholder) + artefact list                |
| `/standards`        | APST alignment / coverage view (placeholder)                    |
| `/present`          | Presentation mode — minimal read-only layout                    |
| `404`               | Styled not-found page, served by Cloudflare                     |

Navigation is a slide-out drawer (`src/components/NavDrawer.astro`) opened from the top bar: Escape closes it, focus is trapped while open, and the links work without JavaScript.

## Project structure

```
astro.config.mjs        Astro config (static output, Tailwind v4 via Vite plugin)
tsconfig.json           Strict TS, `@/*` path alias to src/
public/
  favicon.svg
src/
  components/
    NavDrawer.astro       Slide-out navigation drawer
    Footer.astro          Site footer
    PageHeader.astro      Shared page title block
    WeekCard.astro        Summary tile for one week
    ArtefactCard.astro    One piece of evidence
    ArtefactList.astro    Artefact grid + empty state + (inert) filters
    EvidenceUpload.astro  Placeholder upload form — no backend
    StandardTag.astro     One APST code as a chip
    StandardTagPicker.astro  Placeholder tagging UI (selections not saved)
  layouts/
    BaseLayout.astro         Standard chrome (nav + footer)
    PresentationLayout.astro Stripped-back chrome for presentation mode
  pages/
    index.astro
    portfolio.astro       Portfolio builder
    404.astro
    api/                  On-demand routes (vault, profile, folders, documents)
    evidence.astro
    standards.astro
    present.astro
    sequence/
      index.astro
      [week].astro        Dynamic route → Weeks 1–5
  data/
    portfolio.json        Site/owner metadata
    sequence.json         The five weeks
    artefacts.json        Placeholder artefact records
    standards.json        APST descriptors
  lib/
    portfolio.ts          Data-access seam for the authored (teaching) content
    server/
      access.ts           Cloudflare Access JWT verification
      repo.ts             D1 + R2 data access, scoped to one owner
      handler.ts          Shared auth + error wrapper for /api routes
    vault/
      types.ts            Folder / document / profile types (the API contract)
      db.ts               Browser-side API client
      pdf.ts              PDF export (pdf-lib), byte loader injected
      ui.ts               DOM controller for /portfolio
migrations/
  0001_init.sql           D1 schema
  styles/
    global.css            Tailwind import + design tokens (@theme)
  types.ts                Shared domain types
```

### Two deliberate deviations from a literal "Week 1–5 + APST" build

1. **One dynamic route instead of five week pages.** `src/pages/sequence/[week].astro`
   renders every week from `src/data/sequence.json` via `getStaticPaths()`. Adding,
   reordering or renaming a week is a JSON edit. The output is still five
   pre-rendered HTML files.
2. **Generic domain types, APST as data.** `src/types.ts` describes a `Phase`
   (any time-boxed block of practice) and a `Standard` (any professional
   framework). APST lives in `src/data/standards.json`. Supporting nursing or
   design standards later means adding a JSON file, not refactoring components —
   which is the point of the "universal" in the project description above.

## Data model

`src/lib/portfolio.ts` is the only place that touches the JSON. Pages and
components import from it, so replacing file-based data with a real store is a
single-file change. Helpers: `getPhase`, `getStandard`, `artefactsForPhase`,
`artefactsForStandard`, `standardCoverage`.

## How the PDF export works

`src/lib/vault/pdf.ts` builds the document with pdf-lib, in the browser:

- **Cover page** from the name / role / summary fields.
- **Contents page** with real page numbers. Page indices are recorded during the content pass, then offset by the number of contents pages spliced in afterwards.
- **A divider page per folder**, carrying the folder's optional note. Nested folders are traversed depth-first.
- **Documents**: uploaded PDFs are copied in page-for-page, PNG/JPEG images are placed on their own page with their caption, and anything else becomes a record card noting the filename, type and size.
- **Failures are contained**: a corrupt or unreadable file produces a card explaining why instead of failing the export. Characters outside WinAnsi (emoji, smart quotes) are transliterated or dropped rather than throwing.

## Not built yet (intentionally)

Public sign-up (access is an allowlist, not registration), sharing a portfolio
by link, drag-to-reorder, resumable uploads for large files, artefact previews
in the teaching module, rich-text reflections.

Uploads are capped at 25 MB per file (`MAX_UPLOAD_BYTES` in
`src/lib/server/repo.ts`) — a single Worker request has to hold the body, so
larger files need presigned direct-to-R2 uploads.

## Before real use

Student work must be de-identified before upload. Nothing here enforces that.
