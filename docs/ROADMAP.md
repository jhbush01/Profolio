# Where this is going, and in what order

Companion to `PRODUCT.md` (what this is) and `DECISIONS.md` (what was tried and
rejected). This one is about sequence: what to build next and, more usefully,
what not to build yet.

Read all three before proposing work. Roughly 14k tokens together, and it will
save more than it costs — most feature ideas for ProFolio have been had before,
and several have been rejected for reasons that have not changed.

---

## The state of things, honestly

**Users: one.** Everything below is a guess about value until a second
pre-service teacher has used this on a real placement. That is not a reason to
stop building; it is the reason to sequence carefully and to prefer changes that
can be validated over changes that merely add surface.

**Built and working.** Evidence capture and filing; folders; projects from
templates; a checklist with hand-placed evidence; a report scaffold with
per-practice required-evidence lists; two exports (a printable document at
`/showcase`, a submission bundle from pdf-lib); APST tagging against 37 focus
areas; accounts by Google, Cloudflare and password.

**Open in production, right now.** Sign-up is unauthenticated and the app is on
a public hostname. Anyone who reaches it can create an account. See "Stage 0".

---

## Stage 0 — close what is already open

Not features. These are live, they are cheap, and each one is the sort of thing
that is embarrassing to discover rather than to fix.

1. **Decide who may sign up.** Right now: anyone. The isolation is sound — a new
   account sees an empty vault, tested — so this is not a data-exposure problem.
   It is a cost and a liability problem: 2GB per account, unbounded accounts, on
   your R2 bill. Options, cheapest first: an invite code on sign-up; an
   allowlist of email domains; or leave it open and accept the bill. Pick one
   deliberately rather than by not deciding.
2. **Finish `src/data/privacy.json`.** `operator`, `contactEmail` and
   `storageRegion` still say `TO BE COMPLETED` on a page real users can read.
   Ten minutes, and it is the first document any university privacy officer
   opens.
3. **Password reset.** Currently impossible; both forms say so. Needs Resend, a
   verified sending domain, a token table. Blocked on a domain.
4. **A domain.** Blocks reset email, blocks credible sharing links, blocks
   anything that looks like a product rather than a demo.

---

## Stage 1 — find out whether it works for someone else

One other pre-service teacher, one real placement, start to finish. Watch them
do it; do not send them a link and ask how it went.

The questions worth answering, because every later stage depends on the answers:

- Do they capture evidence during the day, or only when reminded?
- Do they fill in the detail fields, or is every artefact left half-tagged?
- Does the checklist match how their provider actually words the requirements?
- What do they try to do that the app does not offer?

**Everything in Stage 2 is a guess until this is done.** Build the smallest thing
that lets one person finish a placement, then watch.

---

## Stage 2 — the things asked for, in order of value per unit of risk

### 2a. More project templates — build this first

Cheapest real value in the list. Templates are data (`src/lib/programmes/`), a
new one is one file, and `ReportHeading` already carries titles, word ranges,
prompts and required evidence. Nothing structural has to change.

Candidates, in order: a first/second-year placement (shorter, fewer practices);
a graduate-teacher proficiency portfolio; a job-application portfolio. Each one
is also a test of whether the template abstraction actually holds — if a new
programme needs a schema change, that is worth knowing early and cheaply.

### 2b. Home page — cheap, and currently thin

Make it answer "what should I do today". The data exists: what is overdue on
each project's checklist, what is missing detail, what was captured this week.
No new storage. Do it after templates because it is presentation of data the
app already has, and templates change what that data is.

### 2c. HTML export — **partly built already**

`/showcase` renders a project as a printable document. Before building
"HTML export", read that page: the work remaining is probably polish and a
proper title/contents, not a new feature. Check before proposing.

### 2d. The shareable interactive dashboard — **do not start without a sharing model**

This is the fourth time it has come up, and it is the only item on the list with
a way to go badly wrong. `PRODUCT.md` says: *"Never make a document publicly
reachable. Bytes are served only to the owner, with `private, no-store`."* The
evidence is children's work.

It is not forbidden. It is blocked on decisions nobody should make while writing
the code:

- **What is shareable?** Per-artefact opt-in, defaulting to off. Never "share
  the project" as one switch — that ships whatever was in it, including the
  thing filed last week and forgotten.
- **Who can see it?** An unguessable link is not access control. A link plus a
  code, or a link plus an expiry, or a link tied to an email.
- **How does it stop?** Revocation that works immediately, and a visible list of
  what is currently shared. A share nobody can find is a share nobody can end.
- **What does the owner acknowledge?** An explicit, recorded acknowledgement,
  like the de-identification gate — this is the moment a teacher publishes
  student work on the internet, and it should feel like it.
- **Does R2 serve it?** Every byte is `private, no-store` today. A public path
  is a new serving path with its own rules, not a flag on the old one.

Build the answer to those five questions first, as a written decision. The code
is the easy half.

---

## What to check before proposing anything

- `DECISIONS.md` — it may already be rejected, with reasons.
- `/showcase`, `filters.ts`, `place-picker.ts` — several "new" features exist.
- Does it need a migration? The owner applies SQL by hand in the D1 console and
  cannot run terminal commands. Hand over pasteable SQL, always.
- Does it depend on a domain or an email provider? Then it is blocked, and
  saying so is more useful than building half of it.

## How to tell a plan is real

It names the files it touches. It says what is verified and how — this codebase
is debugged by rendering the page and looking at it, not by reading the diff.
It says what it is NOT doing. And it does not quietly widen scope: "while I was
in there" is how a two-file change becomes a twelve-file one nobody reviewed.
