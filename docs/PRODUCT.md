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
- a **checklist** of required evidence items (for GTPA, Appendix 2's audit tool);
- a **date window** (a placement block, a registration period, a school year);
- **generated outputs** (for GTPA, the profile-of-data-collection table and
  the context statement).

Adding registration renewal later must be a new programme definition, not a
schema migration. If a field only makes sense for GTPA, it belongs to the
programme, not to `documents`.

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
6. **Context statement form.** A fully enumerated form, so a fully generated page.
7. **Phone-first capture.** Camera → tag → done, in a corridor between lessons.
   Biggest adoption lever and the hardest to get right.
