# Profolio

Taking the portfolio and creating a digital, universal professional evidence vault + showcase platform designed for professionals such as teachers, nurses and graphic designers.

**Current state: MVP.** Two areas:

1. **Portfolio builder** (`/portfolio`) — industry-neutral and functional. Upload documents, organise them into nested folders, and export the whole portfolio as one PDF with a cover page, contents page and page numbers. Documents are stored in Cloudflare R2, metadata in D1, behind Cloudflare Access.
2. **Teaching portfolio** (`/sequence`, `/evidence`, `/standards`, `/present`) — a worked example: a five-week teaching sequence mapped to the Australian Professional Standards for Teachers (APST). Authored content read from JSON at build time.

Sign-in is Cloudflare Access. Who may sign in, and how, is an Access policy —
an allowlist of addresses, a whole email domain, or open sign-up — and each
signed-in identity owns its own rows. See **Sign-in** below.

## Where to start

- `docs/PRODUCT.md` — what this is, who it is for, and the constraints that are
  not negotiable.
- `docs/DECISIONS.md` — what was tried and rejected, and why. Read before
  proposing a feature.

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

The bucket name and `database_id` are already set in `wrangler.jsonc`. If you
recreate either resource, update them there — `database_id` is an identifier
rather than a credential, so it is committed, as in Cloudflare's own templates.

Note: R2 requires a payment method on the account even to use the free tier (10 GB storage, 1M writes, 10M reads per month, **free egress**). D1's free tier is 500 MB per database and 5 GB per account, with daily caps of 5M rows read and 100K rows written — Cloudflare began enforcing those daily caps on 1 September 2026.

### 2. Create the tables

```bash
npm run db:migrate:remote
```

### 3. Put Cloudflare Access in front of the app

In the Cloudflare dashboard, under **Zero Trust → Access → Applications**, add a
self-hosted application:

- **Domain**: your Worker's hostname, with path `/` (covering `/api/*` too).
- **Policy**: Allow → see **Sign-in** below for what to put here.
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

## Sign-in

**There is no password in this repo, on purpose.** Access supports Google,
Microsoft, GitHub, LinkedIn, SAML and a one-time email code as identity
providers, so "sign in with Google" and "sign in with any email address" are
both settings in a dashboard. An app holding de-identified children's work is
better off never storing a password than storing one carefully — and a
procurement security review is a great deal shorter when the answer to "how do
you protect credentials" is "we never hold any".

### Letting people in with Google

**Zero Trust → Settings → Authentication → Login methods → Add new → Google.**
Cloudflare's setup page walks through creating the OAuth client in Google Cloud
and pasting the client ID and secret back. Nothing in this repo changes:
`src/lib/server/access.ts` verifies whatever token Access issues, and
`src/lib/server/accounts.ts` maps it to an account.

### Letting people in with any email address

Add **One-time PIN** as a login method in the same place. Anyone types an
address, receives a six-digit code, and is signed in. This is the closest thing
to "email and password" that does not require this app to hold a password.

### Who is allowed

The login *method* is separate from the *policy* that decides who may use it.
In the application's **Policies** tab:

| You want | Policy rule |
| --- | --- |
| Only you and a few testers | Include → Emails → list the addresses |
| Everyone at one university | Include → Emails ending in → `@yourinstitution.edu.au` |
| Open sign-up | Include → Everyone |

Open sign-up means anyone on the internet can create an account and upload to
your R2 bucket. `MAX_ACCOUNT_BYTES` in `src/lib/server/repo.ts` bounds what one
account can cost you; nothing bounds how many accounts there are. Do not open it
without deciding that first.

### Signing in with an email address and a password

Built, and it changes how Access is deployed. Access intercepts before any of
this code runs, so it **cannot** keep gating the whole app — a password user
would never reach a page to sign in on. The arrangement is inverted:

| Path | Guarded by |
| --- | --- |
| `/auth/access` | Cloudflare Access (Allow → Everyone) |
| everything else | ProFolio's own session cookie |

`/auth/access` is the bridge: Access proves who you are, and that route turns
the result into the same session cookie a password sign-in issues. Google and
password users then hold the same kind of cookie and no route downstream cares
which they are.

**Deploy in this order. It has no lockout window.**

1. Apply migration `0014_password_sign_in.sql` and deploy the code. Nothing
   changes yet: the chain accepts an Access token *or* a session, so every
   existing sign-in keeps working exactly as before.
2. In the Access application covering `/`, change the policy to
   **Bypass → Everyone**. The app now enforces its own sessions.
3. Add a second Access application on the path `/auth/access`, policy
   **Allow → Everyone** (or your allowlist). This is the Google/Cloudflare door.

If you stop after step 1, Google and Cloudflare keep working and password
sign-in simply is not reachable. Nothing breaks.

**What is stored.** PBKDF2-HMAC-SHA256 at 100,000 iterations with a per-user
salt, parameters kept per row so the cost can be raised and each password
upgraded on next use. Sessions are rows in `account_sessions`; the cookie holds
a random token and only its SHA-256 is stored.

⚠️ **100,000 is the platform ceiling, not a choice.** Workers refuses more —
*"iteration counts above 100000 are not supported"* — so OWASP's current 210,000
for this construction is unavailable here. **The local runtime does not enforce
the cap**, and neither does Node, so this cannot be caught by a passing test; it
shipped wrong once for exactly that reason. `hashPassword` now clamps rather
than trusting the constant.

Halving the iterations costs an attacker one bit. One more word in a passphrase
is worth eleven or twelve, so at this end of the range the password dominates
the hash parameters completely — which is why the 12-character minimum is the
control worth arguing about. Chaining two PBKDF2 calls would reach 200,000
effective iterations and the maths is sound, but it doubles the CPU the cap
exists to bound, so it is not done.

Budget roughly 60ms of CPU per sign-in. Fine on a paid Workers plan; over the
free plan's 10ms allowance.

**A password sign-up always creates a NEW account.** It never adopts an existing
one by email, because an address typed into a public form proves nothing and
adopting on it would hand over somebody else's students' work. Adding a password
to an account that already exists is done from the Account page, while signed
in. This is why no email-verification gate is needed for the feature to be safe.

**Not built.** There is no password reset, because there is no email provider
configured and a reset flow without one is a dead end. A forgotten password is
currently unrecoverable — the sign-up form says so. Adding it means choosing a
sending provider, a secret, and a token table.

### The rule that keeps the chain safe

An authenticator returns `null` only when the request carries no credential of
its kind, and throws when it carries a bad one. Returning `null` for a bad
credential would let a request fall through to the weakest authenticator on the
chain. Access is checked first because it is the stronger proof, so a stale
session can never displace a good token.

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
| `npm run db:migrate:local`  | Create the tables in the local emulated D1 (no build needed) |
| `npm run db:migrate:remote` | Create the tables in the real D1 (no build needed)   |
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

Generated from the tree; if it drifts, trust the tree.

```
src/
  components/          Astro chrome: NavDrawer, BottomNav, AccountMenu,
                       Footer, PageHeader. The rest (WeekCard, ArtefactCard,
                       EvidenceUpload, StandardTag*) belong to the authored
                       teaching-sequence sample, not to the vault.
  layouts/
    BaseLayout.astro         Standard chrome; `width="reading"` narrows the measure
    PresentationLayout.astro Stripped chrome for /present
  pages/
    index.astro          Home — the project grid
    programmes.astro     Projects: start, manage, archive
    project.astro        One project: Hub / Checklist / Evidence / Report / Settings
    capture.astro        Phone-first capture and review
    portfolio.astro      All Artefacts — the folder browser over the whole vault
    export.astro         Choose projects, build the PDF
    pedagogy.astro       Teaching philosophy + what the evidence covers
    account.astro        Cover details, storage, deletion
    privacy.astro        Retention and deletion notice
    data-profile.astro   The data table across the whole vault
    evidence/standards/present/sequence/   The authored sample
    api/                 On-demand routes; everything else is prerendered
  data/                  standards.json (APST), privacy.json, and the sample
  lib/
    portfolio.ts         Data seam for the authored teaching content
    programmes/          Template registry. types.ts is the contract;
                         final-placement.ts and professional-development.ts
                         are data. Adding one is a file plus an index entry.
    server/
      access.ts          Cloudflare Access JWT verification
      accounts.ts        Token → account id (the ownership indirection)
      handler.ts         Shared auth + error wrapper for /api
      repo.ts            D1 + R2, every query scoped to one owner
    vault/
      types.ts           The API contract: folder / document / profile
      dimensions.ts      The evidence vocabularies
      db.ts              Browser-side API client
      file-browser.ts    Folder rows, breadcrumb, drop zone — shared
      detail-panel.ts    The per-artefact details editor — shared
      viewer.ts          Artefact preview dialog
      report.ts          The written report, shared by screen and export
      profile-table.ts   The data collection table, shared by screen and export
      pdf.ts             PDF assembly (pdf-lib); knows nothing about templates
      deidentify.ts      Identifier detection for filenames
      avatar-crop.ts     Profile picture positioning
      *-ui.ts            One DOM controller per page
  styles/global.css      Tailwind import + design tokens (@theme)
migrations/              Applied by hand, in order. See migrations/README.md.
docs/
  PRODUCT.md             Positioning and constraints
  DECISIONS.md           What was tried and rejected
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
by link, offline capture, organisations and roles, an audit log, rich-text
reflections.

Uploads are capped at 80 MB per file (`MAX_UPLOAD_BYTES` in
`src/lib/server/repo.ts`). It cannot go much higher: a single Worker request
has to hold the body and the platform caps that at 100 MB, enforced at the
edge, so a larger file never reaches our code. Beyond that needs presigned
direct-to-R2 multipart uploads.

Drag-to-reorder was built and then removed — see `docs/DECISIONS.md` for why,
along with everything else that was tried and rejected. **Read that file before
planning a feature**; it exists so the same handful of ideas do not get
re-proposed every time.

## Before real use

Student work must be de-identified before upload. Nothing here enforces that.
