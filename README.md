# Profolio

Taking the portfolio and creating a digital, universal professional evidence vault + showcase platform designed for professionals such as teachers, nurses and graphic designers.

**Current state: MVP.** Two areas:

1. **Portfolio builder** (`/portfolio`) — industry-neutral and actually functional. Upload documents, organise them into nested folders, and export the whole portfolio as one PDF with a cover page, contents page and page numbers. Runs entirely in the browser.
2. **Teaching portfolio** (`/sequence`, `/evidence`, `/standards`, `/present`) — a worked example: a five-week teaching sequence mapped to the Australian Professional Standards for Teachers (APST). Authored content, placeholder upload UI.

There is no backend, no database and no authentication.

## Where portfolio data lives — read this first

The portfolio builder stores everything in **IndexedDB in the visitor's browser**. There is no server.

- Files never leave the device. Nothing is uploaded anywhere.
- Portfolios do **not** sync between devices or browsers.
- Clearing site data deletes them.
- **PDF export is the backup path**, and the UI says so on the page.

This is a deliberate MVP trade-off: it makes the app free, private and deployable as static assets. Durable multi-device portfolios need R2 (blobs) + D1 (metadata) + sign-in — see `src/lib/vault/db.ts`, which is written as a single swappable seam for exactly that.

---

## Running locally

Requires Node 18.20.8+, 20.3.0+ or 22+ (this project is developed on Node 22).

```bash
npm install
npm run dev      # http://localhost:4321
```

Other scripts:

| Command           | What it does                                        |
| ----------------- | --------------------------------------------------- |
| `npm run build`   | Builds the static site to `./dist`                   |
| `npm run preview` | Serves the built output locally                      |
| `npm run check`   | Runs `astro check` (TypeScript + template diagnostics) |

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
    vault/
      types.ts            Folder / document / profile types for the builder
      db.ts               IndexedDB store — the swap point for a real backend
      pdf.ts              Client-side PDF export (pdf-lib)
      ui.ts               DOM controller for /portfolio
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

## Deploying to Cloudflare

The build is fully static (`output: 'static'`), so it deploys to Cloudflare
Pages with no adapter and no server runtime:

- Build command: `npm run build`
- Output directory: `dist`

When the evidence upload module needs a real backend, switch to the Cloudflare
adapter (see the commented block in `astro.config.mjs`), add an
`src/pages/api/upload.ts` endpoint backed by an R2 bucket binding, and mark only
the dynamic pages with `export const prerender = false`. Nothing in this
scaffold assumes a server, so that migration is additive.

## How the PDF export works

`src/lib/vault/pdf.ts` builds the document with pdf-lib, in the browser:

- **Cover page** from the name / role / summary fields.
- **Contents page** with real page numbers. Page indices are recorded during the content pass, then offset by the number of contents pages spliced in afterwards.
- **A divider page per folder**, carrying the folder's optional note. Nested folders are traversed depth-first.
- **Documents**: uploaded PDFs are copied in page-for-page, PNG/JPEG images are placed on their own page with their caption, and anything else becomes a record card noting the filename, type and size.
- **Failures are contained**: a corrupt or unreadable file produces a card explaining why instead of failing the export. Characters outside WinAnsi (emoji, smart quotes) are transliterated or dropped rather than throwing.

## Not built yet (intentionally)

Accounts, server-side storage, sync between devices, sharing a portfolio by link, drag-to-reorder, artefact previews in the teaching module, filtering, rich-text reflections. Each has a `FUTURE:` comment where the logic will attach.

## Before real use

Student work must be de-identified before upload. Nothing in this scaffold
enforces that yet.
