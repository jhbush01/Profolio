/**
 * Phone-first capture, then review.
 *
 * The design constraint is a teacher in a corridor between lessons, holding a
 * phone one-handed, with maybe fifteen seconds. The file is therefore stored
 * the moment it is picked and never waits on a form — an interrupted capture
 * that lost the photo would be the worst bug this app could have.
 *
 * What DOES wait is everything else. A stored file counts toward nothing until
 * it is reviewed and saved into a project, one at a time, with every field on
 * the one screen. Discard deletes it outright, so "I did not mean to add that"
 * has a real answer.
 */
import {
  acknowledgeDeid,
  addDocuments,
  ApiError,
  deleteDocument,
  loadProgrammes,
  loadVault,
  updateDocument,
  type Programme,
} from './db';
import { CYCLE_PHASES, EVIDENCE_TYPES, PURPOSES, SUBJECT_SCOPES } from './dimensions';
import { describeFindings, scanFiles } from './deidentify';
import standardsJson from '../../data/standards.json';
import type { VaultDocument } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

const STANDARDS = standardsJson as Array<{ code: string; focus: string; domain: string }>;

/** Uploaded and stored, but not yet reviewed. The front of this is on screen. */
let queue: VaultDocument[] = [];
/** Reviewed and saved in this session, newest first. */
let saved: VaultDocument[] = [];
let acknowledged = false;
let openProgrammes: Programme[] = [];

/**
 * Edits for the record being reviewed, held here rather than written through
 * on every tap: nothing reaches the project until Save.
 */
interface Draft {
  programmes: string[];
  cyclePhase: string | null;
  evidenceType: string | null;
  purpose: string | null;
  subjectScope: string | null;
  selfDesigned: boolean | null;
  standards: string[];
  source: string;
  caption: string;
}

let draft: Draft | null = null;

function setStatus(message: string, busy = false) {
  const host = $('capture-status');
  if (!host) return;
  host.textContent = message;
  host.classList.toggle('animate-pulse', busy);
}

async function guard(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      window.location.reload();
      return;
    }
    setStatus(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function setPickersEnabled(enabled: boolean) {
  for (const id of ['capture-photo-button', 'capture-photos-button', 'capture-file-button']) {
    const button = $<HTMLButtonElement>(id);
    if (button) button.disabled = !enabled;
  }
}

/** The project a capture most likely belongs to — pre-selected, never applied. */
function activeProgramme(): Programme | undefined {
  if (openProgrammes.length === 1) return openProgrammes[0];
  const today = new Date().toISOString().slice(0, 10);
  return openProgrammes
    .filter((p) => p.startsOn && p.endsOn && p.startsOn <= today && today <= p.endsOn)
    .sort((a, b) => (a.startsOn! < b.startsOn! ? 1 : -1))[0];
}

function freshDraft(): Draft {
  const active = activeProgramme();
  return {
    programmes: active ? [active.id] : [],
    cyclePhase: null,
    evidenceType: null,
    purpose: null,
    subjectScope: null,
    selfDesigned: null,
    standards: [],
    source: '',
    caption: '',
  };
}

/* -------------------------------------------------------------- rendering */

/** Big tap targets, wrapping. A <select> on a phone costs two extra taps. */
function chips(
  field: string,
  options: readonly { readonly value: string; readonly label: string }[],
  current: string | null,
): string {
  return options
    .map(
      (option) => `<button type="button" data-field="${field}" data-value="${option.value}"
        aria-pressed="${current === option.value}"
        class="min-h-11 rounded-sm border px-3 py-2 text-sm transition ${
          current === option.value
            ? 'border-mint bg-selected font-medium text-positive'
            : 'border-line bg-surface text-ink-muted'
        }">${escapeHtml(option.label)}</button>`,
    )
    .join('');
}

function fieldBlock(label: string, body: string, hint?: string): string {
  return `<div class="flex flex-col gap-2">
    <p class="pf-eyebrow text-ink-faint">${escapeHtml(label)}</p>
    ${hint ? `<p class="prose-body -mt-1 text-xs">${escapeHtml(hint)}</p>` : ''}
    <div class="flex flex-wrap gap-2">${body}</div>
  </div>`;
}

function reviewCard(): string {
  const doc = queue[0];
  if (!doc || !draft) return '';

  const position = queue.length > 1 ? ` · 1 of ${queue.length}` : '';

  const projectChips =
    openProgrammes.length === 0
      ? `<p class="prose-body text-sm">
           No open project. <a href="/programmes" class="text-accent underline underline-offset-2">Start one</a>,
           or save this and add it to a project later.
         </p>`
      : openProgrammes
          .map((programme) => {
            const on = draft!.programmes.includes(programme.id);
            return `<button type="button" data-field="programme" data-value="${programme.id}"
              aria-pressed="${on}"
              class="min-h-11 rounded-sm border px-3 py-2 text-sm transition ${
                on ? 'border-mint bg-selected font-medium text-positive' : 'border-line bg-surface text-ink-muted'
              }">${escapeHtml(programme.name)}</button>`;
          })
          .join('');

  const standardChips = STANDARDS.map((standard) => {
    const on = draft!.standards.includes(standard.code);
    return `<button type="button" data-field="standard" data-value="${standard.code}"
      title="${escapeHtml(standard.focus)}" aria-pressed="${on}"
      class="min-h-11 rounded-sm border px-3 py-2 font-mono text-sm transition ${
        on ? 'border-mint bg-selected font-medium text-positive' : 'border-line bg-surface text-ink-muted'
      }">${escapeHtml(standard.code)}</button>`;
  }).join('');

  return `<section class="card flex flex-col gap-5 p-5">
    <div class="flex items-start gap-3 border-b border-line-subtle pb-4">
      <div class="min-w-0 flex-1">
        <p class="pf-eyebrow text-ink-faint">Review${escapeHtml(position)}</p>
        <p class="mt-1.5 truncate text-base font-semibold" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</p>
        <p class="mt-0.5 text-xs text-ink-muted">
          Saved to your evidence. It counts toward nothing until you add it below.
        </p>
      </div>
    </div>

    ${fieldBlock('Add to project', projectChips)}
    ${fieldBlock('Stage of the cycle', chips('cyclePhase', CYCLE_PHASES, draft.cyclePhase))}
    ${fieldBlock('Evidence type', chips('evidenceType', EVIDENCE_TYPES, draft.evidenceType))}
    ${fieldBlock('Purpose', chips('purpose', PURPOSES, draft.purpose))}
    ${fieldBlock('Who it is about', chips('subjectScope', SUBJECT_SCOPES, draft.subjectScope))}
    ${fieldBlock(
      'Who designed it',
      chips(
        'selfDesigned',
        [
          { value: 'yes', label: 'I designed it' },
          { value: 'no', label: 'Someone else' },
        ],
        draft.selfDesigned === null ? null : draft.selfDesigned ? 'yes' : 'no',
      ),
    )}
    ${fieldBlock('Standards', standardChips, 'Tap every focus area this speaks to.')}

    <label class="flex flex-col gap-2">
      <span class="pf-eyebrow text-ink-faint">Caption</span>
      <input id="draft-caption" type="text" value="${escapeHtml(draft.caption)}"
        placeholder="What does this show?"
        class="min-h-12 rounded-md border border-line bg-surface px-3 py-2 text-sm" />
    </label>

    <label class="flex flex-col gap-2">
      <span class="pf-eyebrow text-ink-faint">Source</span>
      <input id="draft-source" type="text" value="${escapeHtml(draft.source)}"
        placeholder="Who or what produced it"
        class="min-h-12 rounded-md border border-line bg-surface px-3 py-2 text-sm" />
    </label>

    <div class="flex flex-col gap-2 border-t border-line-subtle pt-4">
      <button type="button" id="draft-save"
        class="min-h-12 w-full rounded-md bg-accent px-4 text-base font-medium text-white transition hover:opacity-90">
        Save${draft.programmes.length > 0 ? ' and add to project' : ''}
      </button>
      <button type="button" id="draft-discard"
        class="min-h-12 w-full rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink-muted transition hover:border-critical/40 hover:text-critical">
        Discard this upload
      </button>
    </div>
  </section>`;
}

function savedList(): string {
  if (saved.length === 0) return '';
  const rows = saved
    .map(
      (doc) => `<li class="flex items-center gap-3 border-t border-line-subtle py-2.5">
        <span class="min-w-0 flex-1 truncate text-sm font-medium" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</span>
        <span class="shrink-0 text-xs text-positive">Saved</span>
      </li>`,
    )
    .join('');

  return `<section class="card p-5">
    <h2 class="text-base font-semibold">Saved just now</h2>
    <ul class="mt-1">${rows}</ul>
  </section>`;
}

function render() {
  const host = $('capture-body');
  if (!host) return;

  if (queue.length > 0 && !draft) draft = freshDraft();
  if (queue.length === 0) draft = null;

  const empty =
    queue.length === 0 && saved.length === 0
      ? `<p class="rounded-lg border border-dashed border-line bg-canvas p-8 text-center text-sm text-ink-muted">
           Nothing captured yet. Use the buttons below.
         </p>`
      : '';

  host.innerHTML = `${reviewCard()}${empty}${savedList()}`;

  // While something is being reviewed, the capture bar is just a fixed strip
  // covering the bottom of a long form. Reviewing and capturing are different
  // moments; only one of them needs the thumb zone.
  const bar = $('capture-bar');
  if (bar) bar.hidden = queue.length > 0;
}

/* ----------------------------------------------------------------- upload */

async function handleFiles(files: FileList | File[]) {
  const list = Array.from(files);
  if (list.length === 0) return;

  if (!acknowledged) {
    setStatus('Confirm the privacy notice first.');
    return;
  }

  const suspicious = scanFiles(list);
  if (suspicious.length > 0 && !window.confirm(describeFindings(suspicious))) {
    setStatus('Cancelled. Rename the file to remove identifiers.');
    return;
  }

  setStatus(`Uploading ${list.length}…`, true);
  await guard('Upload', async () => {
    const result = await addDocuments(list, null);
    // Stored, and nothing more: no project, no dimensions, until it is reviewed.
    queue = [...queue, ...result.added];
    render();
    setStatus(
      list.length === 1
        ? 'Saved. Add the details, or discard it.'
        : `Saved ${list.length}. Review them one at a time.`,
    );
  });
}

/* ---------------------------------------------------------------- actions */

/** Commits the draft: every field and the project membership in one write. */
async function saveDraft() {
  const doc = queue[0];
  if (!doc || !draft) return;
  const pending = draft;

  await guard('Saving', async () => {
    await updateDocument(doc.id, {
      cyclePhase: pending.cyclePhase,
      evidenceType: pending.evidenceType,
      purpose: pending.purpose,
      subjectScope: pending.subjectScope,
      selfDesigned: pending.selfDesigned,
      standards: pending.standards,
      source: pending.source,
      caption: pending.caption,
      programmes: pending.programmes,
    });

    saved = [{ ...doc, ...pending }, ...saved];
    queue = queue.slice(1);
    draft = queue.length > 0 ? freshDraft() : null;
    render();

    const into = openProgrammes.filter((p) => pending.programmes.includes(p.id)).map((p) => p.name);
    setStatus(into.length > 0 ? `Saved into ${into.join(' and ')}.` : 'Saved to your evidence.');
  });
}

/** A real cancel: the file is removed from storage, not just from the queue. */
async function discardDraft() {
  const doc = queue[0];
  if (!doc) return;
  if (!window.confirm(`Discard "${doc.name}"? The file is deleted.`)) return;

  await guard('Discarding', async () => {
    await deleteDocument(doc.id);
    queue = queue.slice(1);
    draft = queue.length > 0 ? freshDraft() : null;
    render();
    setStatus('Discarded.');
  });
}

/* ----------------------------------------------------------------- wiring */

export async function initCapture() {
  await guard('Loading', async () => {
    const snapshot = await loadVault();
    acknowledged = snapshot.deidAcknowledged;
    const gate = $('capture-gate');
    if (gate) gate.hidden = acknowledged;
    setPickersEnabled(acknowledged);
  });

  try {
    const { programmes } = await loadProgrammes();
    openProgrammes = programmes.filter((p) => p.closedAt === null && !p.archived);
  } catch {
    openProgrammes = [];
  }

  $('capture-accept')?.addEventListener('click', async () => {
    await guard('Recording acknowledgement', async () => {
      await acknowledgeDeid();
      acknowledged = true;
      const gate = $('capture-gate');
      if (gate) gate.hidden = true;
      setPickersEnabled(true);
      setStatus('Ready.');
    });
  });

  const photoInput = $<HTMLInputElement>('capture-photo');
  const photosInput = $<HTMLInputElement>('capture-photos');
  const fileInput = $<HTMLInputElement>('capture-file');

  $('capture-photo-button')?.addEventListener('click', () => photoInput?.click());
  $('capture-photos-button')?.addEventListener('click', () => photosInput?.click());
  $('capture-file-button')?.addEventListener('click', () => fileInput?.click());

  for (const input of [photoInput, photosInput, fileInput]) {
    input?.addEventListener('change', async () => {
      if (input.files) await handleFiles(input.files);
      // Cleared so capturing the same filename twice still fires a change.
      input.value = '';
    });
  }

  const body = $('capture-body');

  // Typed fields are read back on save rather than re-rendered on every key,
  // which would move the caret and lose focus mid-word.
  body?.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    if (!draft) return;
    if (target.id === 'draft-caption') draft.caption = target.value;
    if (target.id === 'draft-source') draft.source = target.value;
  });

  body?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!button) return;

    if (button.id === 'draft-save') return saveDraft();
    if (button.id === 'draft-discard') return discardDraft();
    if (!draft) return;

    const field = button.dataset.field;
    const value = button.dataset.value;
    if (!field || value === undefined) return;

    // Tapping the chosen chip again clears it, so a mistake costs one tap.
    if (field === 'programme') {
      draft.programmes = draft.programmes.includes(value)
        ? draft.programmes.filter((id) => id !== value)
        : [...draft.programmes, value];
    } else if (field === 'standard') {
      draft.standards = draft.standards.includes(value)
        ? draft.standards.filter((code) => code !== value)
        : [...draft.standards, value];
    } else if (field === 'selfDesigned') {
      const next = value === 'yes';
      draft.selfDesigned = draft.selfDesigned === next ? null : next;
    } else {
      const key = field as 'cyclePhase' | 'evidenceType' | 'purpose' | 'subjectScope';
      draft[key] = draft[key] === value ? null : value;
    }

    render();
  });

  render();
}
