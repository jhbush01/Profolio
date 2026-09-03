# Profolio

Taking the portfolio and creating a digital, universal professional evidence vault + showcase platform designed for professionals such as teachers, nurses and graphic designers.

**Current state: MVP scaffolding.** The first vertical slice is a teaching portfolio — evidence from a five-week teaching sequence, mapped to the Australian Professional Standards for Teachers (APST). Structure, routing and placeholder UI only; there is no backend, no database and no authentication.

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
| `/`                 | Home — intro, stats, navigation into each module               |
| `/sequence`         | Teaching sequence index                                        |
| `/sequence/[week]`  | One week (Weeks 1–5, generated from `src/data/sequence.json`)   |
| `/evidence`         | Evidence upload UI (placeholder) + artefact list                |
| `/standards`        | APST alignment / coverage view (placeholder)                    |
| `/present`          | Presentation mode — minimal read-only layout                    |

## Project structure

```
astro.config.mjs        Astro config (static output, Tailwind v4 via Vite plugin)
tsconfig.json           Strict TS, `@/*` path alias to src/
public/
  favicon.svg
src/
  components/
    Nav.astro             Primary navigation
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
    portfolio.ts          Single data-access seam — every page reads through here
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

## Not built yet (intentionally)

File storage, persistence of any kind, authentication, artefact previews,
filtering, rich-text reflections, PDF export. Each of these has a `FUTURE:`
comment at the exact place the logic will attach.

## Before real use

Student work must be de-identified before upload. Nothing in this scaffold
enforces that yet.
