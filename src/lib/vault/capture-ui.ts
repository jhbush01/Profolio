/**
 * Phone-first capture.
 *
 * The design constraint is a teacher in a corridor between lessons, holding a
 * phone one-handed, with maybe fifteen seconds. Everything here follows from
 * that: camera first, upload immediately, tag with big targets afterwards, and
 * never block the capture on filling anything in.
 *
 * Anything that needs a keyboard — captions, source, standards — is left to the
 * desktop builder on purpose.
 */
import {
  acknowledgeDeid,
  addDocuments,
  ApiError,
  loadProgrammes,
  loadVault,
  updateDocument,
  type Programme,
} from './db';
import { CYCLE_PHASES, EVIDENCE_TYPES, PURPOSES, SUBJECT_SCOPES } from './dimensions';
import { describeFindings, scanFiles } from './deidentify';
import type { VaultDocument } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Ids captured in this session, newest first — the only thing this page lists. */
let captured: VaultDocument[] = [];
let acknowledged = false;
/** Programmes still accepting evidence. A closed one cannot be assigned to. */
let openProgrammes: Programme[] = [];

function setStatus(message: string, busy = false) {
  const host = $('capture-status');
  if (!host) return;
  host.textContent = message;
  host.classList.toggle('animate-pulse', busy);
}

/** The three pickers are gated together: none of them may run before the notice. */
function setPickersEnabled(enabled: boolean) {
  for (const id of ['capture-photo-button', 'capture-photos-button', 'capture-file-button']) {
    const button = $<HTMLButtonElement>(id);
    if (button) button.disabled = !enabled;
  }
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

/**
 * One row of tag buttons. Big targets, wrapping, no dropdowns — a <select> on a
 * phone opens a modal picker, which is two extra taps per dimension.
 */
function chipRow(
  attribute: string,
  id: string,
  options: readonly { readonly value: string; readonly label: string }[],
  current: string | null,
): string {
  return options
    .map(
      (option) => `<button
        type="button"
        data-${attribute}="${id}"
        data-value="${option.value}"
        class="min-h-11 rounded-sm border px-3 py-2 text-sm transition ${
          current === option.value
            ? 'border-mint bg-selected font-medium text-positive'
            : 'border-line bg-surface text-ink-muted'
        }"
      >${escapeHtml(option.label)}</button>`,
    )
    .join('');
}

/**
 * Which programmes this record counts toward.
 *
 * First in the card, above the dimensions, because it is the question the
 * capture was for: a record in no programme is kept but counts toward nothing.
 */
function programmeRow(doc: VaultDocument): string {
  if (openProgrammes.length === 0) {
    return `<p class="mt-2 text-xs text-ink-muted">
      Not in a programme. <a href="/programmes" class="text-accent underline underline-offset-2">Start one</a> and this counts toward it.
    </p>`;
  }

  const chips = openProgrammes
    .map((programme) => {
      const on = doc.programmes.includes(programme.id);
      return `<button
        type="button"
        data-programme-toggle="${doc.id}"
        data-programme="${programme.id}"
        aria-pressed="${on}"
        class="min-h-11 rounded-sm border px-3 py-2 text-sm transition ${
          on ? 'border-mint bg-selected font-medium text-positive' : 'border-line bg-surface text-ink-muted'
        }"
      >${escapeHtml(programme.name)}</button>`;
    })
    .join('');

  return `<p class="mt-3 text-xs font-medium text-ink-muted">Counts toward</p>
    <div class="mt-1 flex flex-wrap gap-1.5">${chips}</div>`;
}

function renderCaptured() {
  const host = $('capture-list');
  const empty = $('capture-empty');
  if (!host) return;

  if (captured.length === 0) {
    host.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  host.innerHTML = captured
    .map(
      (doc) => `<article class="rounded-lg border border-line bg-surface p-3" data-capture="${doc.id}">
        <p class="truncate text-sm font-medium" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</p>

        ${programmeRow(doc)}

        <p class="mt-3 text-xs font-medium text-ink-muted">Stage</p>
        <div class="mt-1 flex flex-wrap gap-1.5">${chipRow('phase', doc.id, CYCLE_PHASES, doc.cyclePhase)}</div>

        <p class="mt-3 text-xs font-medium text-ink-muted">What is it</p>
        <div class="mt-1 flex flex-wrap gap-1.5">${chipRow('etype', doc.id, EVIDENCE_TYPES, doc.evidenceType)}</div>

        <p class="mt-3 text-xs font-medium text-ink-muted">Purpose</p>
        <div class="mt-1 flex flex-wrap gap-1.5">${chipRow('purpose', doc.id, PURPOSES, doc.purpose)}</div>

        <p class="mt-3 text-xs font-medium text-ink-muted">Who</p>
        <div class="mt-1 flex flex-wrap gap-1.5">${chipRow('scope', doc.id, SUBJECT_SCOPES, doc.subjectScope)}</div>
      </article>`,
    )
    .join('');
}

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

    // Pre-assign to whatever is being collected for right now, so the common
    // case costs no taps at all. It is a chip the user can turn off, not a
    // decision made for them.
    const active = activeProgramme();
    if (active) {
      for (const doc of result.added) {
        try {
          await updateDocument(doc.id, { programmes: [active.id] });
          doc.programmes = [active.id];
        } catch {
          // A failed assignment must not lose the capture: the file is already
          // saved, and the chips below let them set it by hand.
        }
      }
    }

    // Newest first, so the thing just captured is under the thumb.
    captured = [...result.added, ...captured];
    renderCaptured();
    setStatus(
      active
        ? `Saved to ${active.name}. Tag it below, or just keep capturing.`
        : 'Saved. Tag it below, or just keep capturing.',
    );
  });
}

/**
 * The programme a capture most likely belongs to: the open one whose window
 * covers today. With several, the one that started most recently wins; with
 * none dated, a single open programme is still an obvious guess.
 */
function activeProgramme(): Programme | undefined {
  if (openProgrammes.length === 1) return openProgrammes[0];

  const today = new Date().toISOString().slice(0, 10);
  const running = openProgrammes
    .filter((p) => p.startsOn && p.endsOn && p.startsOn <= today && today <= p.endsOn)
    .sort((a, b) => (a.startsOn! < b.startsOn! ? 1 : -1));

  return running[0];
}

export async function initCapture() {
  // The gate is shared with the builder; capture must respect it too.
  await guard('Loading', async () => {
    const snapshot = await loadVault();
    acknowledged = snapshot.deidAcknowledged;
    const gate = $('capture-gate');
    if (gate) gate.hidden = acknowledged;
    setPickersEnabled(acknowledged);
  });

  // Separate from the vault load: a programmes failure should cost the chips,
  // not the ability to capture.
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

  // One delegated handler for every tag chip.
  $('capture-list')?.addEventListener('click', async (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLElement>('button[data-programme-toggle]');
    if (toggle) {
      const id = toggle.dataset.programmeToggle!;
      const programmeId = toggle.dataset.programme!;
      const doc = captured.find((d) => d.id === id);
      if (!doc) return;

      const next = doc.programmes.includes(programmeId)
        ? doc.programmes.filter((p) => p !== programmeId)
        : [...doc.programmes, programmeId];

      await guard('Saving programme', async () => {
        await updateDocument(id, { programmes: next });
        doc.programmes = next;
        renderCaptured();
      });
      return;
    }

    const button = (event.target as HTMLElement).closest<HTMLElement>('button[data-value]');
    if (!button) return;

    const value = button.dataset.value!;
    const map: Array<[string, keyof VaultDocument]> = [
      ['phase', 'cyclePhase'],
      ['etype', 'evidenceType'],
      ['purpose', 'purpose'],
      ['scope', 'subjectScope'],
    ];

    for (const [attribute, field] of map) {
      const id = button.dataset[attribute];
      if (!id) continue;

      const doc = captured.find((d) => d.id === id);
      if (!doc) return;
      // Tapping the selected chip again clears it.
      const next = doc[field] === value ? null : value;

      await guard('Saving tag', async () => {
        await updateDocument(id, { [field]: next });
        (doc[field] as string | null) = next;
        renderCaptured();
      });
      return;
    }
  });

  renderCaptured();
}
