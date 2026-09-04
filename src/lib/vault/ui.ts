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
  addDocument,
  clearAll,
  createFolder,
  deleteDocument,
  deleteFolderDeep,
  estimateUsage,
  getProfile,
  listDocuments,
  listFolders,
  saveProfile,
  updateDocument,
  updateFolder,
} from './db';
import type { VaultDocument, VaultFolder, VaultProfile } from './types';
import { renderKindFor } from './types';

const ALL = '__all__';
const UNFILED = '__unfiled__';

let folders: VaultFolder[] = [];
let documents: VaultDocument[] = [];
let profile: VaultProfile = { name: '', title: '', summary: '' };
let selected: string = ALL;

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

function kindBadge(doc: VaultDocument): string {
  const kind = renderKindFor(doc.mime, doc.name);
  const label = kind === 'pdf' ? 'PDF' : kind === 'image' ? 'Image' : 'File';
  const tone =
    kind === 'unsupported'
      ? 'bg-canvas text-ink-muted'
      : 'bg-accent-soft text-accent';
  return `<span class="rounded px-1.5 py-0.5 text-[0.65rem] font-medium ${tone}">${label}</span>`;
}

/** Documents shown for the current selection. */
function visibleDocuments(): VaultDocument[] {
  if (selected === ALL) return documents;
  if (selected === UNFILED) return documents.filter((doc) => !doc.folderId);
  return documents.filter((doc) => doc.folderId === selected);
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

function renderFolders() {
  const host = $('folder-tree');
  if (!host) return;

  const counts = (id: string | null) => documents.filter((doc) => doc.folderId === id).length;

  const row = (id: string, label: string, count: number, depth: number, extra = '') => {
    const active = selected === id;
    return `<li>
      <div class="group flex items-center gap-1 rounded-lg ${active ? 'bg-accent-soft' : 'hover:bg-canvas'}">
        <button type="button" data-select="${id}" class="flex-1 truncate px-3 py-2 text-left text-sm ${active ? 'font-medium text-accent' : ''}" style="padding-left:${12 + depth * 14}px">
          ${escapeHtml(label)}
          <span class="ml-1 text-xs text-ink-muted">${count}</span>
        </button>
        ${extra}
      </div>
    </li>`;
  };

  const controls = (folder: VaultFolder) => `
    <span class="flex items-center gap-0.5 pr-1.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
      <button type="button" data-subfolder="${folder.id}" title="Add subfolder" aria-label="Add subfolder in ${escapeHtml(folder.name)}" class="rounded p-1 text-ink-muted hover:bg-surface hover:text-accent">+</button>
      <button type="button" data-rename="${folder.id}" title="Rename" aria-label="Rename ${escapeHtml(folder.name)}" class="rounded p-1 text-xs text-ink-muted hover:bg-surface hover:text-accent">✎</button>
      <button type="button" data-delete-folder="${folder.id}" title="Delete" aria-label="Delete ${escapeHtml(folder.name)}" class="rounded p-1 text-xs text-ink-muted hover:bg-surface hover:text-red-600">✕</button>
    </span>`;

  let html = `<ul class="space-y-0.5">`;
  html += row(ALL, 'All documents', documents.length, 0);
  html += row(UNFILED, 'Unfiled', documents.filter((doc) => !doc.folderId).length, 0);
  html += `</ul><div class="my-3 border-t border-line"></div><ul class="space-y-0.5">`;

  const walk = (parentId: string | null, depth: number) => {
    for (const folder of folders.filter((f) => f.parentId === parentId)) {
      html += row(folder.id, folder.name, counts(folder.id), depth, controls(folder));
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  html += `</ul>`;

  if (folders.length === 0) {
    html += `<p class="px-3 py-4 text-xs text-ink-muted">No folders yet. Create one to group your documents — folders become the sections of the exported PDF.</p>`;
  }

  host.innerHTML = html;
}

function renderDocuments() {
  const host = $('document-list');
  const heading = $('list-heading');
  const noteWrap = $('folder-note-wrap');
  const noteField = $<HTMLTextAreaElement>('folder-note');
  if (!host || !heading) return;

  const current = folders.find((folder) => folder.id === selected);
  heading.textContent =
    selected === ALL ? 'All documents' : selected === UNFILED ? 'Unfiled' : folderPath(selected);

  // The section note only applies to a real folder.
  if (noteWrap && noteField) {
    noteWrap.hidden = !current;
    if (current) noteField.value = current.note;
  }

  const items = visibleDocuments();
  if (items.length === 0) {
    host.innerHTML = `<p class="rounded-xl border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">
      Nothing here yet. Use <strong class="font-medium">Add files</strong> above, or drop files onto this page.
    </p>`;
    return;
  }

  const options = (doc: VaultDocument) => {
    const opts = [`<option value="">Unfiled</option>`];
    const walk = (parentId: string | null, depth: number) => {
      for (const folder of folders.filter((f) => f.parentId === parentId)) {
        const label = `${'  '.repeat(depth)}${folder.name}`;
        opts.push(
          `<option value="${folder.id}"${doc.folderId === folder.id ? ' selected' : ''}>${escapeHtml(label)}</option>`,
        );
        walk(folder.id, depth + 1);
      }
    };
    walk(null, 0);
    return opts.join('');
  };

  host.innerHTML = items
    .map(
      (doc) => `
      <article class="card flex flex-col gap-3">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <h3 class="truncate text-sm font-semibold" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name)}</h3>
            <p class="mt-1 flex items-center gap-2 text-xs text-ink-muted">
              ${kindBadge(doc)} ${formatBytes(doc.size)}
              ${doc.folderId ? `· ${escapeHtml(folderPath(doc.folderId))}` : ''}
            </p>
          </div>
          <button type="button" data-delete-doc="${doc.id}" aria-label="Remove ${escapeHtml(doc.name)}" class="shrink-0 rounded p-1 text-xs text-ink-muted hover:text-red-600">✕</button>
        </div>

        <input
          type="text"
          data-caption="${doc.id}"
          value="${escapeHtml(doc.caption)}"
          placeholder="Caption (appears under this document in the PDF)"
          class="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs"
        />

        <label class="flex items-center gap-2 text-xs text-ink-muted">
          Folder
          <select data-move="${doc.id}" class="flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs">
            ${options(doc)}
          </select>
        </label>
      </article>`,
    )
    .join('');
}

async function renderUsage() {
  const host = $('usage');
  if (!host) return;
  const usage = await estimateUsage();
  const totalBytes = documents.reduce((sum, doc) => sum + doc.size, 0);
  host.textContent = usage
    ? `${documents.length} file${documents.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)} stored · browser allows about ${formatBytes(usage.quota)}`
    : `${documents.length} file${documents.length === 1 ? '' : 's'} · ${formatBytes(totalBytes)} stored`;
}

async function refresh() {
  [folders, documents] = await Promise.all([listFolders(), listDocuments()]);
  if (selected !== ALL && selected !== UNFILED && !folders.some((f) => f.id === selected)) {
    selected = ALL;
  }
  renderFolders();
  renderDocuments();
  await renderUsage();
}

/* ----------------------------------------------------------------- actions */

async function handleFiles(files: FileList | File[]) {
  const target = selected === ALL || selected === UNFILED ? null : selected;
  for (const file of Array.from(files)) await addDocument(file, target);
  await refresh();
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
    const bytes = await buildPortfolioPdf(profile, folders, documents, (done, total, label) => {
      setStatus(`Adding ${done + 1} of ${total}: ${label}`, true);
    });
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
    setStatus(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    button.disabled = false;
  }
}

/* ------------------------------------------------------------------- wiring */

export async function initVault() {
  profile = await getProfile();
  const nameField = $<HTMLInputElement>('profile-name');
  const titleField = $<HTMLInputElement>('profile-title');
  const summaryField = $<HTMLTextAreaElement>('profile-summary');
  if (nameField) nameField.value = profile.name;
  if (titleField) titleField.value = profile.title;
  if (summaryField) summaryField.value = profile.summary;

  const persistProfile = async () => {
    profile = {
      name: nameField?.value ?? '',
      title: titleField?.value ?? '',
      summary: summaryField?.value ?? '',
    };
    await saveProfile(profile);
  };
  [nameField, titleField, summaryField].forEach((field) =>
    field?.addEventListener('change', persistProfile),
  );

  $('new-folder')?.addEventListener('click', async () => {
    const name = window.prompt('Folder name');
    if (!name?.trim()) return;
    const folder = await createFolder(name.trim(), null);
    selected = folder.id;
    await refresh();
  });

  const fileInput = $<HTMLInputElement>('file-input');
  $('add-files')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    if (fileInput.files) await handleFiles(fileInput.files);
    fileInput.value = '';
  });

  $('export-pdf')?.addEventListener('click', exportPdf);

  $('clear-all')?.addEventListener('click', async () => {
    if (!window.confirm('Delete every folder and document in this browser? This cannot be undone.')) return;
    await clearAll();
    selected = ALL;
    profile = { name: '', title: '', summary: '' };
    if (nameField) nameField.value = '';
    if (titleField) titleField.value = '';
    if (summaryField) summaryField.value = '';
    await refresh();
    setStatus('Cleared.');
  });

  $<HTMLTextAreaElement>('folder-note')?.addEventListener('change', async (event) => {
    if (selected === ALL || selected === UNFILED) return;
    await updateFolder(selected, { note: (event.target as HTMLTextAreaElement).value });
    await refresh();
  });

  // Folder tree actions (delegated, because the tree is re-rendered wholesale).
  $('folder-tree')?.addEventListener('click', async (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;

    const select = button.dataset.select;
    if (select) {
      selected = select;
      renderFolders();
      renderDocuments();
      return;
    }

    const sub = button.dataset.subfolder;
    if (sub) {
      const name = window.prompt('Subfolder name');
      if (!name?.trim()) return;
      const folder = await createFolder(name.trim(), sub);
      selected = folder.id;
      await refresh();
      return;
    }

    const rename = button.dataset.rename;
    if (rename) {
      const folder = folders.find((f) => f.id === rename);
      const name = window.prompt('Rename folder', folder?.name ?? '');
      if (!name?.trim()) return;
      await updateFolder(rename, { name: name.trim() });
      await refresh();
      return;
    }

    const remove = button.dataset.deleteFolder;
    if (remove) {
      const folder = folders.find((f) => f.id === remove);
      const inside = documents.filter((doc) => doc.folderId === remove).length;
      const warning = inside
        ? `Delete "${folder?.name}" and the ${inside} document${inside === 1 ? '' : 's'} inside it?`
        : `Delete "${folder?.name}"?`;
      if (!window.confirm(warning)) return;
      await deleteFolderDeep(remove);
      await refresh();
    }
  });

  // Document actions.
  const list = $('document-list');
  list?.addEventListener('click', async (event) => {
    const id = (event.target as HTMLElement).closest('button')?.dataset.deleteDoc;
    if (!id) return;
    const doc = documents.find((d) => d.id === id);
    if (!window.confirm(`Remove "${doc?.name}" from the portfolio?`)) return;
    await deleteDocument(id);
    await refresh();
  });
  list?.addEventListener('change', async (event) => {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.dataset.caption) {
      await updateDocument(target.dataset.caption, { caption: target.value });
      documents = await listDocuments();
      return;
    }
    if (target.dataset.move) {
      await updateDocument(target.dataset.move, { folderId: target.value || null });
      await refresh();
    }
  });

  // Drag and drop anywhere on the page.
  const dropHint = $('drop-hint');
  let dragDepth = 0;
  window.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    if (dropHint) dropHint.hidden = false;
  });
  window.addEventListener('dragover', (event) => event.preventDefault());
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0 && dropHint) dropHint.hidden = true;
  });
  window.addEventListener('drop', async (event) => {
    event.preventDefault();
    dragDepth = 0;
    if (dropHint) dropHint.hidden = true;
    if (event.dataTransfer?.files?.length) await handleFiles(event.dataTransfer.files);
  });

  await refresh();
}
