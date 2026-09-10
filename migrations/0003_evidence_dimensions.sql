-- Evidence dimensions.
--
-- All nullable and all optional at upload: capture happens in a classroom on a
-- phone, and a required field there means the file never gets uploaded at all.
-- Detail is added later; the UI badges what is still missing.
--
-- These are deliberately generic career-long dimensions, not GTPA fields — see
-- docs/PRODUCT.md. They happen to be exactly what a profile-of-data-collection
-- table needs, which is the point.

-- When the artefact was made, as distinct from when it was uploaded.
ALTER TABLE documents ADD COLUMN captured_at INTEGER;

-- Where in the teaching cycle: plan | teach | assess | reflect | appraise
ALTER TABLE documents ADD COLUMN cycle_phase TEXT;

-- What kind of evidence: work-sample | assessment-data | observation | plan | ...
ALTER TABLE documents ADD COLUMN evidence_type TEXT;

-- Why it was collected: diagnostic | formative | summative | other
ALTER TABLE documents ADD COLUMN purpose TEXT;

-- Who or what produced it. Free text, e.g. "school NAPLAN summary".
ALTER TABLE documents ADD COLUMN source TEXT;

-- Whole cohort, or one pseudonymous individual: cohort | individual
ALTER TABLE documents ADD COLUMN subject_scope TEXT;

-- Did the practitioner design the instrument? 1 yes, 0 no, NULL unknown.
ALTER TABLE documents ADD COLUMN self_designed INTEGER;

-- APST focus areas, stored as a JSON array of codes e.g. ["1.5","5.4"].
-- D1 has no array type. A join table would be tidier for querying by standard,
-- but every consumer here loads the whole document set anyway, so the extra
-- table would buy nothing today.
ALTER TABLE documents ADD COLUMN standards TEXT;
