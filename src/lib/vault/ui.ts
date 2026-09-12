/**
 * Client-side controller for the portfolio builder page.
 *
 * Plain TypeScript against the DOM rather than a UI framework: this is the only
 * interactive page in the app, and keeping it framework-free means the site
 * stays a pure static build with no hydration setup.
 *
 * FUTURE: if a second interactive surface appears, move this to an island
 * framework rather than growing this file.
 */
import {
  acknowledgeDeid,
  addDocuments,
  describeError,
  isAuthError,
  reloadForAuth,
  createFolder,
  deleteDocument,
  deleteFolderDeep,
  documentBytes,
  emptyProfile,
  loadProgrammes,
  loadVault,
  updateDocument,
  updateFolder,
  type Programme,
} from './db';
import { describeFindings, scanFiles } from './deidentify';
import {
  CYCLE_PHASES,
  EVIDENCE_TYPES,
  isComplete,
  missingDimensions,
  PURPOSES,
  SUBJECT_SCOPES,
} from './dimensions';
import standardsJson from '../../data/standards.json';
import {
  breadcrumbHtml,
  childFolders,
  fileSize,
  folderCounts,
  folderRow,
  kindLabel,
  shortDate,
  type BrowserOptions,
} from './file-browser';
import type { VaultDocument, VaultFolder, VaultProfile } from './types';
import { wireViewer } from './viewer';

let folders: VaultFolder[] = [];
let documents: VaultDocument[] = [];
let profile: VaultProfile = emptyProfile;
/** The open folder, null for the top level. */
let cursor: string | null = null;
/** Free-text filter applied on top of the folder selection. */
let search = '';
let deidAcknowledged = false;
/** Account storage allowance, from the last snapshot. */
let storage: { usedBytes: number; limitBytes: number } | null = null;
/** Programmes still accepting evidence; closed ones offer no control. */
let openProgrammes: Programme[] = [];

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STANDARDS = standardsJson as Array<{ code: string; focus: string; domain: string }>;

type Option = { readonly value: string; readonly label: string };

/** A <select> with a blank "not set" option, since every dimension is optional. */
function selectFor(
  attribute: string,
  id: string,
  options: readonly Option[],
  current: string | null,
  placeholder: string,
): string {
  const items = options
    .map(
      (option) =>
        `<option value="${option.value}"${current === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`,
    )
    .join('');
  return `<select data-${attribute}="${id}" class="w-full rounded-lg border border-line bg-surface px-2 py-1 text-xs">
    <option value=""${current ? '' : ' selected'}>${escapeHtml(placeholder)}</option>${items}
  </select>`;
}

/**
 * Programme membership for one record.
 *
 * Closed programmes are left out: they cannot take new evidence, and offering
 * a control the server will refuse is worse than not offering it.
 */
function programmeChips(doc: VaultDocument): string {
  if (openProgrammes.length === 0) {
    return `<p class="text-[0.7rem] text-ink-muted">
      No open projects. <a href="/programmes" class="text-accent underline underline-offset-2">Start one</a> to assign this record.
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
        class="rounded-sm border px-2 py-0.5 text-[0.7rem] transition ${
          on ? 'border-mint bg-selected font-medium text-positive' : 'border-line text-ink-muted'
        }"
      >${escapeHtml(programme.name)}</button>`;
    })
    .join('');

  return `<div class="flex flex-wrap gap-1">${chips}</div>`;
}

/** The evidence-dimension panel, collapsed by default so the list stays scannable. */
function detailPanel(doc: VaultDocument): string {
  const gaps = missingDimensions(doc);
  const summary =
    gaps.length === 0
      ? '<span class="text-ink-muted">Details</span> <span class="text-positive">· complete</span>'
      : `<span class="text-ink-muted">Details</span> <span class="text-caution">· missing ${escapeHtml(gaps.join(', '))}</span>`;

  const standardChips = STANDARDS.map(
    (standard) => `<label
        title="${escapeHtml(standard.focus)}"
        class="cursor-pointer rounded-sm border border-line px-2 py-0.5 font-mono text-[0.7rem] text-ink-muted transition has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:checked]:font-medium has-[:checked]:text-accent"
      >
        <input
          type="checkbox"
          data-standard="${doc.id}"
          value="${standard.code}"
          ${doc.standards.includes(standard.code) ? 'checked' : ''}
          class="sr-only"
        />${standard.code}
      </label>`,
  ).join('');

  const designed = doc.selfDesigned;

  // The folder list, so a file can be moved from the panel that already holds
  // everything else about it.
  const folderOptions = (() => {
    const opts = [`<option value="">Top level</option>`];
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of childFolders(folders, parentId)) {
        opts.push(
          `<option value="${folder.id}"${doc.folderId === folder.id ? ' selected' : ''}>${escapeHtml(
            `${'— '.repeat(depth)}${folder.name}`,
          )}</option>`,
        );
        walk(folder.id, depth + 1);
      }
    };
    walk(null, 0);
    return opts.join('');
  })();

  return `<details class="mb-2.5 rounded-lg border border-line">
    <summary class="cursor-pointer px-3 py-2 text-xs">${summary}</summary>
    <div class="grid gap-2 border-t border-line p-3 sm:grid-cols-2">
      <input
        type="text"
        data-caption="${doc.id}"
        value="${escapeHtml(doc.caption)}"
        placeholder="Caption, printed under this file in the export"
        class="rounded-lg border border-line bg-surface px-2 py-1 text-xs sm:col-span-2"
      />
      ${selectFor('phase', doc.id, CYCLE_PHASES, doc.cyclePhase, 'Stage of the cycle…')}
      ${selectFor('etype', doc.id, EVIDENCE_TYPES, doc.evidenceType, 'Evidence type…')}
      ${selectFor('purpose', doc.id, PURPOSES, doc.purpose, 'Purpose…')}
      ${selectFor('scope', doc.id, SUBJECT_SCOPES, doc.subjectScope, 'Whole class or individual…')}
      <input
        type="text"
        data-source="${doc.id}"
        value="${escapeHtml(doc.source ?? '')}"
        placeholder="Source, e.g. school NAPLAN summary"
        class="rounded-lg border border-line bg-surface px-2 py-1 text-xs sm:col-span-2"
      />
      <label class="flex items-center gap-2 text-xs text-ink-muted sm:col-span-2">
        <span>Who designed it?</span>
        <select data-designed="${doc.id}" class="rounded-lg border border-line bg-surface px-2 py-1 text-xs">
          <option value=""${designed === null ? ' selected' : ''}>Not set</option>
          <option value="yes"${designed === true ? ' selected' : ''}>I designed it</option>
          <option value="no"${designed === false ? ' selected' : ''}>Someone else / commercial</option>
        </select>
      </label>
      <div class="sm:col-span-2">
        <p class="mb-1 text-[0.7rem] font-medium text-ink-muted">APST focus areas</p>
        <div class="flex flex-wrap gap-1">${standardChips}</div>
      </div>
      <div class="sm:col-span-2">
        <p class="mb-1 text-[0.7rem] font-medium text-ink-muted">Counts toward</p>
        ${programmeChips(doc)}
      </div>
      <label class="flex items-center gap-2 text-xs text-ink-muted sm:col-span-2">
        <span>Folder</span>
        <select data-move="${doc.id}" class="flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs">
          ${folderOptions}
        </select>
      </label>
    </div>
  </details>`;
}

/**
 * Documents shown for the current folder selection and search.
 *
 * Searching looks past the file name into the caption, the source and the
 * names of the projects a record counts toward, because "the certificate from
 * the first placement" is how people remember an artefact — not as
 * IMG_4032.jpeg, which is what the phone called it.
 */
function visibleDocuments(): VaultDocument[] {
  // Searching reaches across every folder. A search that only looked inside the
  // folder you happen to have open is a search that cannot find anything you
  // have lost, which is the only reason to search.
  const needle = search.trim().toLowerCase();
  const inFolder = needle
    ? documents
    : documents.filter((doc) => (doc.folderId ?? null) === cursor);
  if (!needle) return inFolder;

  const programmeName = new Map(openProgrammes.map((p) => [p.id, p.name.toLowerCase()]));
  return inFolder.filter((doc) =>
    [
      doc.name,
      doc.caption,
      doc.source ?? '',
      ...doc.programmes.map((id) => programmeName.get(id) ?? ''),
    ]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
}

function folderPath(id: string | null): string {
  const parts: string[] = [];
  let current = folders.find((folder) => folder.id === id);
  while (current) {
    parts.unshift(current.name);
    current = folders.find((folder) => folder.id === current!.parentId);
  }
  return parts.join(' / ');
}

/* --------------------------------------------------------------- rendering */

function browserOptions(): BrowserOptions {
  return {
    folders,
    allDocuments: documents,
    scoped: documents,
    cursor,
    frozen: false,
    // Every record is in scope here, so "from other projects" is meaningless.
    showElsewhere: false,
  };
}

/**
 * The folder browser, where a grid of cards used to be.
 *
 * The cards were tiles two to a row, each carrying a caption box, a folder
 * dropdown and a collapsed detail panel. Twenty artefacts filled three screens
 * and finding one meant scrolling past the other nineteen. This is the same
 * filing cabinet the projects use: a breadcrumb, the folders at this level,
 * then the files, one line each, with the details a click away on the line
 * itself.
 */
function renderDocuments() {
  const host = $('document-list');
  const noteWrap = $('folder-note-wrap');
  const noteField = $<HTMLTextAreaElement>('folder-note');
  if (!host) return;

  const current = folders.find((folder) => folder.id === cursor);
  if (noteWrap && noteField) {
    noteWrap.hidden = !current;
    if (current) noteField.value = current.note;
  }

  const crumbs = $('folder-crumbs');
  if (crumbs) crumbs.innerHTML = breadcrumbHtml(folders, cursor, 'All artefacts');

  const searching = search.trim().length > 0;
  const items = visibleDocuments();
  const subfolders = searching ? [] : childFolders(folders, cursor);

  if (items.length === 0 && subfolders.length === 0) {
    host.innerHTML = `<p class="rounded-lg border border-dashed border-line bg-canvas px-4 py-8 text-center text-sm text-ink-muted">
      ${searching ? 'Nothing matches that.' : 'Nothing here yet.'}
    </p>`;
    return;
  }

  const options = browserOptions();
  host.innerHTML = `<ul>${subfolders.map((folder) => folderRow(options, folder)).join('')}${items
    .map((doc) => artefactRow(doc, searching))
    .join('')}</ul>`;
}

/**
 * One artefact: a line, with its details folded away underneath it.
 *
 * The details panel is the same one the cards carried — it was the good part of
 * them. What changed is that it is closed until you want it, so a folder of
 * thirty files is thirty lines rather than thirty forms.
 */
function artefactRow(doc: VaultDocument, searching: boolean): string {
  const where = doc.folderId ? folderPath(doc.folderId) : 'Top level';

  return `<li class="border-t border-line-subtle" data-doc-id="${doc.id}">
    <div class="flex items-center gap-3 py-2.5">
      <span class="min-w-0 flex-1">
        <button type="button" data-view="${doc.id}" title="${escapeHtml(doc.name)}"
          class="block max-w-full truncate text-left text-sm font-medium transition hover:text-accent hover:underline">
          ${escapeHtml(doc.name)}
        </button>
        <span class="mt-0.5 block text-xs text-ink-faint">
          <span class="font-mono">${escapeHtml(kindLabel(doc))} · ${escapeHtml(fileSize(doc.size))} · ${escapeHtml(shortDate(doc.addedAt))}</span>
          ${searching ? `· ${escapeHtml(where)}` : ''}
          <span data-needs-detail ${isComplete(doc) ? 'hidden' : ''} class="text-caution">· needs detail</span>
        </span>
      </span>
      <button type="button" data-delete-doc="${doc.id}" aria-label="Remove ${escapeHtml(doc.name)}"
        class="shrink-0 rounded p-1 text-xs text-ink-faint hover:text-critical">✕</button>
    </div>
    ${detailPanel(doc)}
  </li>`;
}

/**
 * Updates one card's badge and panel summary without re-rendering the list.
 *
 * A full refresh would close the <details> the user is actively filling in and
 * lose their scroll position, which makes enriching a dozen records miserable.
 */
function refreshCardStatus(doc: VaultDocument) {
  const card = document.querySelector<HTMLElement>(`[data-doc-id="${doc.id}"]`);
  if (!card) return;

  const gaps = missingDimensions(doc);

  const badge = card.querySelector<HTMLElement>('[data-needs-detail]');
  if (badge) badge.hidden = gaps.length === 0;

  const summary = card.querySelector<HTMLElement>('details > summary');
  if (summary) {
    summary.innerHTML =
      gaps.length === 0
        ? '<span class="text-ink-muted">Details</span> <span class="text-positive">· complete</span>'
        : `<span class="text-ink-muted">Details</span> <span class="text-caution">· missing ${escapeHtml(gaps.join(', '))}</span>`;
  }

  renderPendingCount();
}

/** "N need detail" in the list header — the nudge to come back and enrich. */
function renderPendingCount() {
  const host = $('pending-detail');
  if (!host) return;
  const pending = visibleDocuments().filter((doc) => !isComplete(doc)).length;
  host.hidden = pending === 0;
  host.textContent = pending === 1 ? '1 needs detail' : `${pending} need detail`;
}

function renderSearchSummary() {
  const host = $('search-summary');
  if (!host) return;
  const needle = search.trim();
  if (!needle) {
    host.textContent = '';
    return;
  }
  const found = visibleDocuments().length;
  host.textContent =
    found === 0
      ? `Nothing matches "${needle}".`
      : `${found} artefact${found === 1 ? '' : 's'} match "${needle}".`;
}

function renderUsage() {
  const host = $('usage');
  if (!host) return;
  const totalBytes = documents.reduce((sum, doc) => sum + doc.size, 0);
  const count = `${documents.length} file${documents.length === 1 ? '' : 's'}`;
  // The allowance is only worth naming once it is close enough to matter;
  // "0.4 MB of 2.0 GB" on day one is noise.
  const near = storage && totalBytes > storage.limitBytes * 0.75;
  host.textContent = near
    ? `${count} · ${formatBytes(totalBytes)} of ${formatBytes(storage!.limitBytes)} used`
    : `${count} · ${formatBytes(totalBytes)} in R2`;
}

async function refresh() {
  const snapshot = await loadVault();
  // Programmes are a side concern here: a failure costs the membership chips,
  // never the document list itself.
  try {
    const { programmes } = await loadProgrammes();
    openProgrammes = programmes.filter((p) => p.closedAt === null && !p.archived);
  } catch {
    openProgrammes = [];
  }
  folders = snapshot.folders;
  documents = snapshot.documents;
  profile = snapshot.profile;
  deidAcknowledged = snapshot.deidAcknowledged;
  storage = snapshot.storage;


  // Uploads stay locked until the de-identification notice is acknowledged.
  const gate = $('deid-gate');
  if (gate) gate.hidden = deidAcknowledged;
  for (const id of ['add-files', 'export-pdf']) {
    const button = $<HTMLButtonElement>(id);
    if (button) button.disabled = !deidAcknowledged;
  }

  if (cursor && !folders.some((f) => f.id === cursor)) cursor = null;
  renderDocuments();
  renderUsage();
  renderPendingCount();
  renderSearchSummary();
}

/**
 * Runs an action, surfacing failures in the status line instead of throwing
 * into the console. A 401 usually means the Access session lapsed, and
 * reloadForAuth bounces the user through the login page — but only a couple of
 * times per minute, after which the failure is shown rather than retried.
 */
async function guard(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    if (isAuthError(error)) {
      setStatus('Your sign-in expired. Reloading…');
      if (reloadForAuth()) return;
    }
    setStatus(`${label} failed: ${describeError(error)}`);
  }
}

/* ----------------------------------------------------------------- actions */

async function handleFiles(files: FileList | File[]) {
  if (!deidAcknowledged) {
    setStatus('Acknowledge the de-identification notice before uploading.');
    $('deid-gate')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const list = Array.from(files);

  // Warn — never silently block — on filenames that look like identifiers.
  const suspicious = scanFiles(list);
  if (suspicious.length > 0 && !window.confirm(describeFindings(suspicious))) {
    setStatus('Upload cancelled. Rename the files to remove identifiers, then try again.');
    return;
  }
  setStatus(`Uploading ${list.length} file${list.length === 1 ? '' : 's'}…`, true);
  await guard('Upload', async () => {
    await addDocuments(list, cursor);
    await refresh();
    setStatus(`Uploaded ${list.length} file${list.length === 1 ? '' : 's'}.`);
  });
}

function setStatus(message: string, busy = false) {
  const host = $('export-status');
  if (!host) return;
  host.textContent = message;
  host.classList.toggle('animate-pulse', busy);
}

async function exportPdf() {
  const button = $<HTMLButtonElement>('export-pdf');
  if (!button) return;
  if (documents.length === 0) {
    setStatus('Add at least one document before exporting.');
    return;
  }

  button.disabled = true;
  setStatus('Loading the PDF engine…', true);
  try {
    // pdf-lib is ~400KB; load it only when someone actually exports, so the
    // page itself stays light.
    const { buildPortfolioPdf } = await import('./pdf');
    setStatus('Building PDF…', true);
    const bytes = await buildPortfolioPdf(
      profile,
      folders,
      documents,
      // Bytes are pulled from R2 one document at a time, so exporting a large
      // portfolio never needs the whole thing in memory at once.
      (doc) => documentBytes(doc.id),
      (done, total, label) => setStatus(`Adding ${done + 1} of ${total}: ${label}`, true),
    );
    // Copy into a fresh ArrayBuffer so the Blob owns its own memory.
    const blob = new Blob([bytes.slice()], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const stem = (profile.name || 'portfolio').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    link.href = url;
    link.download = `${stem || 'portfolio'}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`Exported ${formatBytes(blob.size)}.`);
  } catch (error) {
    setStatus(`Export failed: ${describeError(error)}`);
  } finally {
    button.disabled = false;
  }
}

/* --------------------------------------------------------------- reordering */

/*
 * Drag-to-reorder is gone with the cards.
 *
 * It never worked: any drag anywhere on the page — including picking a card up
 * to move it — tripped a window-level dragenter that threw a full-screen "Drop
 * files to add them" panel over everything, with a depth counter that did not
 * survive the crossings and so left the panel stuck until something was
 * dropped. The reorder it was fighting for is also not the control it looked
 * like: export order is section order now, and inside a section it is the
 * folder you filed the record in.
 */

/* ------------------------------------------------------------------- wiring */

export async function initVault() {
  $('new-folder')?.addEventListener('click', async () => {
    const name = window.prompt('Folder name');
    if (!name?.trim()) return;
    await guard('Creating folder', async () => {
      const folder = await createFolder(name.trim(), cursor);
      cursor = folder.id;
      await refresh();
    });
  });

  const fileInput = $<HTMLInputElement>('file-input');
  $('add-files')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    if (fileInput.files) await handleFiles(fileInput.files);
    fileInput.value = '';
  });

  $('export-pdf')?.addEventListener('click', exportPdf);

  $('deid-accept')?.addEventListener('click', async () => {
    const box = $<HTMLInputElement>('deid-confirm');
    if (box && !box.checked) {
      setStatus('Tick the box to confirm you understand.');
      return;
    }
    await guard('Recording acknowledgement', async () => {
      await acknowledgeDeid();
      await refresh();
      setStatus('Uploads are now enabled.');
    });
  });

  const documentList = $('document-list');
  if (documentList) wireViewer(documentList, (id) => documents.find((doc) => doc.id === id));

  $<HTMLInputElement>('doc-search')?.addEventListener('input', (event) => {
    search = (event.target as HTMLInputElement).value;
    renderDocuments();
    renderPendingCount();
    renderSearchSummary();
  });

  $<HTMLTextAreaElement>('folder-note')?.addEventListener('change', async (event) => {
    const folderId = cursor;
    if (!folderId) return;
    const note = (event.target as HTMLTextAreaElement).value;
    await guard('Saving note', async () => {
      await updateFolder(folderId, { note });
      await refresh();
    });
  });

  // Folder actions, delegated on the list, because the list is where the
  // folders now are.
  $('document-list')?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!button) return;

    const open = button.dataset.openFolder;
    if (open !== undefined) {
      cursor = open || null;
      renderDocuments();
      return;
    }

    const rename = button.dataset.renameFolder;
    if (rename) {
      const folder = folders.find((f) => f.id === rename);
      const name = window.prompt('Rename folder', folder?.name ?? '');
      if (!name?.trim() || name.trim() === folder?.name) return;
      await guard('Renaming', async () => {
        await updateFolder(rename, { name: name.trim() });
        await refresh();
      });
      return;
    }

    const remove = button.dataset.deleteFolder;
    if (remove) {
      const folder = folders.find((f) => f.id === remove);
      const inside = folderCounts(browserOptions(), remove).total;
      if (
        !window.confirm(
          `Delete "${folder?.name ?? 'this folder'}" and everything inside it?\n\n` +
            `${inside} file${inside === 1 ? '' : 's'} will be permanently deleted. This cannot be undone.`,
        )
      ) {
        return;
      }
      await guard('Deleting folder', async () => {
        await deleteFolderDeep(remove);
        await refresh();
      });
    }
  });

  // The breadcrumb sits outside the list, so it needs its own listener.
  $('folder-crumbs')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('button[data-open-folder]');
    if (!button) return;
    cursor = button.dataset.openFolder || null;
    renderDocuments();
  });

  // Document actions.
  const list = $('document-list');
  list?.addEventListener('click', async (event) => {
    const id = (event.target as HTMLElement).closest('button')?.dataset.deleteDoc;
    if (!id) return;
    const doc = documents.find((d) => d.id === id);
    if (!window.confirm(`Remove "${doc?.name}" from the portfolio?`)) return;
    await guard('Deleting document', async () => {
      await deleteDocument(id);
      await refresh();
    });
  });
  list?.addEventListener('click', async (event) => {
    const toggle = (event.target as HTMLElement).closest<HTMLElement>('button[data-programme-toggle]');
    if (!toggle) return;

    const id = toggle.dataset.programmeToggle!;
    const programmeId = toggle.dataset.programme!;
    const doc = documents.find((d) => d.id === id);
    if (!doc) return;

    const next = doc.programmes.includes(programmeId)
      ? doc.programmes.filter((p) => p !== programmeId)
      : [...doc.programmes, programmeId];

    await guard('Saving project', async () => {
      await updateDocument(id, { programmes: next });
      doc.programmes = next;
      // Re-render just this card's chips, so an open <details> stays open.
      const host = toggle.parentElement;
      if (host) host.outerHTML = programmeChips(doc);
      setStatus('Saved.');
    });
  });

  list?.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;

    /** Saves one dimension, then updates the badge in place. */
    const saveDimension = async (id: string, patch: Record<string, unknown>, apply: (doc: VaultDocument) => void) => {
      await guard('Saving detail', async () => {
        await updateDocument(id, patch);
        const doc = documents.find((d) => d.id === id);
        if (doc) {
          apply(doc);
          refreshCardStatus(doc);
        }
        setStatus('Saved.');
      });
    };

    const blank = (value: string) => (value === '' ? null : value);

    if (target.dataset.phase) {
      const v = blank(target.value);
      return saveDimension(target.dataset.phase, { cyclePhase: v }, (d) => (d.cyclePhase = v));
    }
    if (target.dataset.etype) {
      const v = blank(target.value);
      return saveDimension(target.dataset.etype, { evidenceType: v }, (d) => (d.evidenceType = v));
    }
    if (target.dataset.purpose) {
      const v = blank(target.value);
      return saveDimension(target.dataset.purpose, { purpose: v }, (d) => (d.purpose = v));
    }
    if (target.dataset.scope) {
      const v = blank(target.value);
      return saveDimension(target.dataset.scope, { subjectScope: v }, (d) => (d.subjectScope = v));
    }
    if (target.dataset.source) {
      const v = target.value;
      return saveDimension(target.dataset.source, { source: v }, (d) => (d.source = v));
    }
    if (target.dataset.designed) {
      const v = target.value === '' ? null : target.value === 'yes';
      return saveDimension(target.dataset.designed, { selfDesigned: v }, (d) => (d.selfDesigned = v));
    }
    if (target.dataset.standard) {
      const id = target.dataset.standard;
      const card = document.querySelector<HTMLElement>(`[data-doc-id="${id}"]`);
      const codes = [...(card?.querySelectorAll<HTMLInputElement>('[data-standard]') ?? [])]
        .filter((box) => box.checked)
        .map((box) => box.value);
      return saveDimension(id, { standards: codes }, (d) => (d.standards = codes));
    }

    if (target.dataset.caption) {
      const id = target.dataset.caption;
      await guard('Saving caption', async () => {
        await updateDocument(id, { caption: target.value });
        const doc = documents.find((d) => d.id === id);
        if (doc) doc.caption = target.value;
      });
      return;
    }
    if (target.dataset.move) {
      const id = target.dataset.move;
      await guard('Moving document', async () => {
        await updateDocument(id, { folderId: target.value || null });
        await refresh();
      });
    }
  });


  // Dropping onto the zone, and only onto the zone. This used to be bound to
  // the window with a full-screen overlay; see the note above enableDocument-
  // Dragging for why that was worse than nothing.
  const zoneOf = (event: Event) => (event.target as HTMLElement)?.closest?.('[data-drop]');

  document.addEventListener('dragover', (event) => {
    const zone = zoneOf(event);
    if (!zone) return;
    // Files only. A drag carrying text or an element is not an upload, and
    // lighting up for one is how the old overlay earned its reputation.
    if (!(event as DragEvent).dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    zone.classList.add('border-accent', 'bg-accent-soft');
  });
  document.addEventListener('dragleave', (event) => {
    zoneOf(event)?.classList.remove('border-accent', 'bg-accent-soft');
  });
  document.addEventListener('drop', async (event) => {
    const zone = zoneOf(event);
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('border-accent', 'bg-accent-soft');
    const files = (event as DragEvent).dataTransfer?.files;
    if (files?.length) await handleFiles(files);
  });

  await guard('Loading your artefacts', refresh);
}
