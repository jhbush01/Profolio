# Decisions, and what was rejected

Code records what a thing does. It cannot record what was tried and thrown
away, so every new contributor — human or model — re-proposes the same handful
of ideas and has to be talked out of them again.

This file is that conversation, written down once.

`PRODUCT.md` is the *why* of the product. `README.md` is the *how* of the
build. This is the **what not to do, and why not**.

---

## Read these first, in this order

Planning a feature here does not require reading the codebase. It requires:

1. `docs/PRODUCT.md` — positioning, the legal constraints, the
   programme-as-overlay architecture, the evidence dimensions.
2. This file.
3. `src/lib/vault/types.ts` and `src/lib/vault/dimensions.ts` — the API
   contract and the vocabularies. ~150 lines, and they are the domain.
4. `src/lib/programmes/types.ts` — what a programme template can declare.
   Adding a template is a new file plus one line in `index.ts`.
5. `migrations/*.sql` in order — the schema, and the order it arrived in.

That is about 11k tokens and covers most decisions.

If you need more, read the **doc comment at the top of each file** in
`src/lib/` before reading any function body. This codebase carries its
reasoning in those headers on purpose; the mechanics below them are the least
interesting part.

---

## Not up for renegotiation

These are settled. A proposal that requires one of them to be relaxed is not a
proposal, it is a different product.

### The app never writes the user's analysis

No drafting, no suggesting, no starter sentences, no "improve this paragraph",
no summarising their evidence into prose. Prompts are questions only.

This is not squeamishness. The GTPA coversheet carries a statement of
authenticity, and the 2026 context statement requires declaring any AI use. An
app that writes the reflection creates an academic-integrity problem for the
user and hands their institution a reason to ban it outright. The single
fastest way to kill this product is to ship a "help me write this" button.

### Assessment *structure* may be used. Assessment *content* may not.

Taken, and correct to take: section headings, the list of required elements,
the context-statement field list, the data table's column headings, per-section
word counts. These are the shape a submission must have, which a candidate is
told and must follow. Producing a correctly laid-out document is the product.

Never taken: criteria, standards descriptors, rubrics, exemplars, marking
guidance, or the booklet's own explanatory prose. Tag against **APST** — public
AITSL material — never against assessment criteria text.

All of it lives as replaceable data in `src/lib/programmes/*.ts`, with stable
`id`s and `legacyKeys`, so a provider's annual revision is an edit to one file
and nobody's written work moves.

### Privacy constraints are hard

See PRODUCT.md. In particular: bytes are served only to the owner with
`private, no-store`, and nothing is ever publicly reachable. If a feature needs
a shareable link to a document, it needs a design conversation first, not an
implementation.

---

## Rejected, with reasons

### Architecture

**Inferring programme membership from evidence dimensions.** Built, then
removed in `0006_programme_assignment.sql`. Predicate matching produced an
unstable output: a record captured in 2029 that happened to match a 2026
placement's checklist silently changed what that placement contained, and an
export of a portfolio already submitted must not move. Predicates were demoted
to a suggester — "3 records match this checklist but are not in it". Nothing
joins a programme without the user accepting it. Full reasoning in PRODUCT.md.

**Folders owned by a project.** Proposed as the natural reading of "a folder
system inside of the projects". Rejected: a record has **one** folder and
**any number** of projects. A project-owned folder cannot hold a record shared
with another project, and sharing evidence across projects is the thing this
app does that a folder of files does not.

What shipped instead: folders stay vault-wide, and a project's Evidence tab
opens the same filing cabinet filtered to that project's records, showing each
folder's total alongside so the shared drawers are visible rather than
surprising. See the header of `src/lib/vault/file-browser.ts`.

**A template stored on the user's profile.** Rejected — a practitioner
accumulates programmes across a career, and storing "the chosen template" would
mean starting a PD record silently destroyed the placement one. Programmes are
rows.

### Export

**Word (.docx) instead of PDF.** Considered and not built. The exporter
assembles client-side with pdf-lib and copies uploaded PDFs in page-for-page,
which is what makes an evidence bundle readable. A .docx cannot embed a PDF
page — the evidence would have to be rasterised, losing its text and its
selectability. Revisit only if an institution mandates .docx, and treat it as a
second exporter rather than a replacement.

**Video embedded in the export.** Not possible in practice. No PDF reader an
assessor realistically uses will play an embedded movie, and shipping one that
silently does nothing is worse than saying so. Recordings are stored, viewable
in-app with byte-range streaming, and represented in the export by a card
naming the file and telling the reader to ask for it.

**Context statement and data table as separate slabs.** The export used to
print a context page, then a report, then a table, each with its own title.
Replaced by an outline: the template declares which heading owns the context
lines and which owns the table, and `pdf.ts` interleaves them into one run of
pages. `pdf.ts` still knows nothing about templates — the caller pre-resolves
everything into `ReportEntry[]`. Keep it that way.

### Interface

**A tile/card grid for artefacts.** Removed. Cards are for browsing things you
are choosing between; a placement's evidence is a hundred files you are looking
*for*. Twenty artefacts filled three screens, and finding one meant scrolling
past the other nineteen. Replaced by the folder browser, one line per file.

**Drag-to-reorder.** Built, then removed with the cards. It never worked: any
drag anywhere on the page tripped a window-level `dragenter` that threw a
full-screen "Drop files to add them" panel over everything, with a depth
counter that did not survive the element crossings and so left the panel stuck
until something was dropped.

The ordering it was fighting for is also not the control it appeared to be:
export order is section order now, and within a section it is the folder you
filed the record in. `reorderDocuments` and `/api/order` still exist and are
currently unused — either find them a job or delete them.

**A full-window drop target.** See above. The drop zone is a box you can see,
it ignores drags not carrying files, and it is scoped to the page region that
will receive them.

**Dragging a row onto a folder to move it.** Rejected: lovely with a mouse,
impossible with a thumb, and this app is used on a phone in a corridor. Moving
is a control inside the record's details panel.

**Context as its own tab.** Removed. It made the setting a form you filled in
somewhere else and never looked at again, when it is in fact the opening
paragraphs of the report. It is now editable in place under the heading that
owns it. `?tab=context` redirects to the report so old links still land.

**Averaged statistics across every project on Home.** Moved to the project's
own Hub tab. Averaging answered a question nobody asks — "how am I going
overall" — while the one that matters is "what does this placement still need".

**A dashed 'start a project' tile in the project grid.** Removed. A tile that
is not a project should not sit in the row of projects at project size.

**A subtitle under every page heading.** Removed. A paragraph explaining what
"Projects" means is a paragraph nobody reads twice and everybody scrolls past
once. Kept only where the text is load-bearing: the de-identification notice,
and where the files physically live.

### Security

**Caching the profile picture.** `/api/profile/avatar` was served
`private, max-age=300` against one URL shared by every account, and the badge
in the top bar requested it with no cache-buster. Sign out, sign in as somebody
else, and the browser answered from its own cache with the previous account's
face under the new account's name. Now `no-store` with `Vary: Cookie`.

The general rule this is an instance of: **any per-account endpoint on a fixed
URL must be `no-store` or carry the account in the URL.** There is no third
option that survives a shared device.

---

## Open, and not for a planner to settle alone

These are live questions with real trade-offs. Raise them; do not decide them.

**Accounts are adopted by email.** `resolveAccount` gives a new sign-in an
existing account when the verified email matches, which is what carries a user
across a change of identity provider — and what means signing in with Google
and with Cloudflare on the same address lands on the same ProFolio. The
accepted trade is that a *recycled* institutional address would hand the new
holder the old account. Fine for a personal tool; a decision to revisit before
selling into an institution that reissues graduate addresses.

**Selling this.** Ordering matters more than features: an audit log before
organisations and roles, and sharing after both. Sharing built on top of an
account model with no audit trail is the kind of thing that is discovered
during a procurement review rather than fixed before one.

**Offline capture.** No service worker, deliberately. A caching bug that loses
a capture is worse than a failed upload the user can see. When it is built, it
should queue uploads explicitly rather than cache the app shell and hope.

**Uploads above 80MB.** `MAX_UPLOAD_BYTES` cannot go much higher: a Worker's
request body is capped at 100MB and the cap is enforced at the edge, so an
oversized file never reaches our code and the user gets an opaque failure.
Longer recordings need presigned multipart uploads straight to R2 — a real
piece of work, not a bigger number.

---

## Before proposing anything, check these

Two things are live in production and unfinished. A plan that ignores them is
planning on sand.

- `src/data/privacy.json` still contains `TO BE COMPLETED` for `operator`,
  `contactEmail` and `storageRegion`.
- Migrations are applied by hand (see `migrations/README.md`). Schema-dependent
  code must not ship before its migration runs; it has broken production twice.
  `handler.ts` now turns the resulting D1 error into a readable 503, which is a
  mitigation and not a fix.

## How to check a plan is real

A plan written against a snapshot of this repo cannot run the app, cannot see
whether a migration is applied, and cannot tell that a control it is proposing
already exists under a different name. Three cheap tests before committing to
one:

1. **Does it need a schema change?** If yes, it is a migration plus a hand-run
   step plus a deploy ordering problem, not a UI task.
2. **Does it belong to a programme or to the vault?** If a field only makes
   sense for one programme, it belongs to the programme. This is the single
   most common architectural mistake here.
3. **Would it survive being looked at?** Almost every bug in this codebase was
   found by rendering the page and looking at it, not by reading the diff.
   Prefer plans whose result is visible.
