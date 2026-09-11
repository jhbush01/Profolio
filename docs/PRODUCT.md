# Product direction

## Positioning

Profolio is **an evidence vault for a teaching career**. It stores a
practitioner's own artefacts, lets them tag and organise those artefacts, and
prints their own records.

It is deliberately **not** a GTPA guide, coach, or submission generator.

That distinction is load-bearing, not cosmetic. The 2026 GTPA Preservice
Teacher Booklet instructs candidates not to use "other materials that are not
affiliated with the GTPA" while preparing a submission. A third-party app that
interprets GTPA criteria, reproduces its rubric, or tells a candidate what to
write invites an academic-integrity problem for the user and a trademark
problem for us (GTPA® is a registered mark with its own certification regime).

So the rules are:

- Tag against **APST** — public AITSL material — never GTPA criteria text.
- Never reproduce the GTPA rubric, standards descriptors, or exemplars.
- Never draft or suggest reflective writing. The GTPA coversheet carries a
  statement of authenticity and the context statement now requires declaring
  any AI use. Organising your own evidence is defensible; writing your
  analysis is not.
- Keep "GTPA" out of the product name.

What we *do* build is the boring, valuable part: capture evidence as it
happens, with enough structure that the outputs a candidate must produce
anyway can be generated instead of reconstructed from memory at 11pm.

## Strategy: acquisition vs retention

The GTPA is a **single-use, seasonal, zero-retention** event — roughly 4–7
weeks, once, in a final year. As a standalone product that is a bad business:
no repeat use, spiky demand, students with no money, and a free official
template already in their hand.

It is, however, the most stressful evidence-collection moment in an Australian
teacher's life, which makes it an excellent **acquisition** moment.

Retention comes from what happens afterwards. Registered teachers in Australia
maintain evidence for registration renewal and annual professional learning
for their entire career. That is the same primitive — dated artefacts, tagged
against APST, exported as a tidy document — on a lifelong cadence.

**Therefore: the data model must never be GTPA-shaped.**

## Architecture consequence: programmes are an overlay

The vault stores generic evidence. A **programme** is a separate, pluggable
layer that says "for this purpose, these items are required, and here is the
document it produces".

```
documents / folders          generic, permanent, career-long
    ↑
evidence dimensions          when in a cycle, what type, what purpose,
                             whose work, self-designed or commercial
    ↑
programme overlay            GTPA final placement · registration renewal
                             · annual performance review
                             → required-item checklist + generated outputs
```

A programme owns:
- a **checklist** of required evidence items, each satisfied by assigned
  evidence whose dimensions match a predicate;
- a **date window**, so the checklist can say what should exist *by now*;
- **generated outputs** (currently the data-collection profile).

Adding registration renewal later must be a new programme definition, not a
schema migration. If a field only makes sense for one programme, it belongs to
the programme, not to `documents`.

### Programmes are rows, not a setting

A template is deliberately **not** a field on the user's account. A
practitioner accumulates programmes across a career — a final placement, then
professional-development years, then a renewal period — and each keeps its own
name, window and progress. Storing "the chosen template" on the profile would
mean starting a PD record silently destroyed the placement one.

### Membership is assigned, not inferred

Evidence joins a programme because the user put it there. This replaced pure
predicate matching in `0006_programme_assignment.sql`, for a reason that only
shows up at submission time: **predicate matching produced an unstable
output**. A record captured in 2029 that happened to match a 2026 placement's
checklist silently changed what that placement contained — and an export of a
portfolio already handed in must not move.

So `document_programmes` is a many-to-many join table, and predicates were
demoted to a *suggester*: "3 records match this checklist but are not in it".
Nothing joins a programme without the user accepting it.

Many-to-many was the part worth keeping from the old model. A compliance
certificate is evidence for a placement *and* for that year's professional
development, and must not have to be uploaded twice.

**Closing** (`closed_at`) fixes what a programme holds — no additions, and no
removals either, enforced in `Repo.setDocumentProgrammes` rather than only in
the UI. Reopening stamps `reopened_at` rather than clearing the record, so a
portfolio whose contents changed after submission can be told apart from one
that never moved.

Implemented in `src/lib/programmes/`. Adding a template is a new file plus one
entry in `index.ts` — no schema change, and nothing in the vault knows it
exists.

## Evidence dimensions

These are generic enough to serve any career stage, and happen to be exactly
what the GTPA's mandatory profile-of-data-collection table requires:

| Dimension | Generic meaning | Why it exists |
| --- | --- | --- |
| `captured_at` | when the artefact was made | ordering, date windows |
| `cycle_phase` | plan / teach / assess / reflect / appraise | the teaching cycle; also maps to any review cycle |
| `evidence_type` | work sample, observation, assessment data, plan, … | grouping and checklists |
| `purpose` | diagnostic / formative / summative / other | why it was collected |
| `source` | who or what produced it | provenance |
| `subject_scope` | whole cohort vs one pseudonymous individual | differentiation evidence |
| `self_designed` | did the practitioner build the instrument | shows design capability |
| `standards[]` | APST focus areas | the one framework we reference |

## Privacy is a product constraint, not a feature

Evidence in this domain includes children's work. That is the highest-risk
data the app will ever hold, and the risk is ours as much as the user's.

- Pseudonyms only. Individuals are referred to as Focus A / B / C or a
  user-chosen alias, never a real name.
- Warn before upload on anything that looks like an identifier — a probable
  personal name, an email address, a long digit run, a date of birth.
- Require an explicit, recorded acknowledgement before the first upload.
- Never make a document publicly reachable. Bytes are served only to the
  owner, with `private, no-store`.

## Build sequence

Ordered easiest-first within dependency order.

1. **De-identification guard.** Recorded acknowledgement before first upload,
   plus identifier warnings. First because it reduces the most risk.
2. **Drag-to-reorder.** Export order is submission order.
3. **Evidence dimensions.** Schema + capture UI + API. Everything below needs it.
4. **Generated data-collection profile.** The table a candidate currently
   rebuilds from memory.
5. **Programme checklist with progress.** "By week 3, have I collected…".
6. **Context statement.** Shipped. The questions are declared by the template,
   not stored as columns, and the answers live on the programme as JSON — a
   placement wants sector, year level and class size; a professional-development
   year wants almost none of that. Duration is derived from the programme's own
   window rather than asked twice, and the generated statement is copyable.
7. **Phone-first capture.** Camera → tag → done, in a corridor between lessons.
   Biggest adoption lever. Shipped: /capture, with the capture bar pinned to the
   thumb zone, `capture="environment"` for the rear camera, and large tap chips
   instead of dropdowns (a `<select>` on a phone opens a modal picker, costing
   two extra taps per dimension).

   Installable from a home screen via a web manifest, with `start_url` of
   `/capture` — the reason to keep this on a phone is capture, not browsing.

   **Not yet: offline.** There is no service worker. Classroom wifi is usually
   fine and a caching bug that loses a capture is worse than a failed upload the
   user can see. Offline queueing is the next thing worth building here, and it
   should queue uploads explicitly rather than caching the app shell and hoping.
