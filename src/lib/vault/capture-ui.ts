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
  loadVault,
  updateDocument,
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
        class="rounded-full border px-3 py-2 text-sm transition ${
          current === option.value
            ? 'border-accent bg-accent text-white'
            : 'border-line bg-surface text-ink-muted'
        }"
      >${escapeHtml(option.label)}</button>`,
    )
    .join('');
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
      (doc) => `<article class="rounded-xl border border-line bg-surface p-3" data-capture="${doc.id}">
        <p class="truncate text-sm font-medium" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</p>

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
    // Newest first, so the thing just captured is under the thumb.
    captured = [...result.added, ...captured];
    renderCaptured();
    setStatus(`Saved. Tag it below, or just keep capturing.`);
  });
}

export async function initCapture() {
  // The gate is shared with the builder; capture must respect it too.
  await guard('Loading', async () => {
    const snapshot = await loadVault();
    acknowledged = snapshot.deidAcknowledged;
    const gate = $('capture-gate');
    if (gate) gate.hidden = acknowledged;
    for (const id of ['capture-photo-button', 'capture-file-button']) {
      const button = $<HTMLButtonElement>(id);
      if (button) button.disabled = !acknowledged;
    }
  });

  $('capture-accept')?.addEventListener('click', async () => {
    await guard('Recording acknowledgement', async () => {
      await acknowledgeDeid();
      acknowledged = true;
      const gate = $('capture-gate');
      if (gate) gate.hidden = true;
      for (const id of ['capture-photo-button', 'capture-file-button']) {
        const button = $<HTMLButtonElement>(id);
        if (button) button.disabled = false;
      }
      setStatus('Ready.');
    });
  });

  const photoInput = $<HTMLInputElement>('capture-photo');
  const fileInput = $<HTMLInputElement>('capture-file');

  $('capture-photo-button')?.addEventListener('click', () => photoInput?.click());
  $('capture-file-button')?.addEventListener('click', () => fileInput?.click());

  for (const input of [photoInput, fileInput]) {
    input?.addEventListener('change', async () => {
      if (input.files) await handleFiles(input.files);
      // Cleared so capturing the same filename twice still fires a change.
      input.value = '';
    });
  }

  // One delegated handler for every tag chip.
  $('capture-list')?.addEventListener('click', async (event) => {
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
