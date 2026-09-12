/**
 * Looking at one artefact.
 *
 * Until this existed you could not see a thing you had captured. An artefact
 * was a filename and a badge, and the only way to look at the photo you took
 * in a corridor three weeks ago was to export the whole portfolio as a PDF.
 * That made the core loop — capture, find, check — impossible to finish.
 *
 * Bytes are fetched on demand, one artefact at a time, and the object URL is
 * revoked on close. Nothing is cached and no thumbnail is stored: the content
 * endpoint is `private, no-store` because these are children's work, and
 * keeping that promise is worth a fetch per look.
 *
 * One dialog, created once and reused, appended to <body> so it escapes any
 * transformed or overflow-hidden ancestor it was opened from.
 */
import { describeError, documentBytes, isAuthError, reloadForAuth } from './db';
import type { VaultDocument } from './types';
import { renderKindFor } from './types';

let dialog: HTMLDialogElement | null = null;
let objectUrl: string | null = null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function releaseUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
}

function ensureDialog(): HTMLDialogElement {
  if (dialog) return dialog;

  dialog = document.createElement('dialog');
  // `m-auto` rather than the browser default: Tailwind's reset zeroes the
  // margin a native <dialog> relies on to centre itself, which left this
  // pinned to the top of the viewport.
  dialog.className =
    'm-auto w-[min(64rem,92vw)] max-w-none rounded-lg border border-line bg-surface p-0 text-ink ' +
    'backdrop:bg-ink/60 backdrop:backdrop-blur-[1px]';
  dialog.innerHTML = `
    <div class="flex items-start justify-between gap-4 border-b border-line px-5 py-3">
      <div class="min-w-0">
        <h2 data-viewer-name class="truncate text-sm font-semibold"></h2>
        <p data-viewer-meta class="mt-0.5 text-xs text-ink-muted"></p>
      </div>
      <button
        type="button"
        data-viewer-close
        aria-label="Close"
        class="-mr-1 shrink-0 rounded-md px-2 py-1 text-sm font-medium text-ink-muted transition hover:bg-canvas hover:text-ink"
      >Close</button>
    </div>
    <div data-viewer-body class="flex min-h-[16rem] items-center justify-center bg-canvas p-4"></div>`;

  // Backdrop clicks land on the dialog itself, not on its children.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog!.close();
  });
  dialog.querySelector('[data-viewer-close]')?.addEventListener('click', () => dialog!.close());
  // Covers Escape as well as the button, since both fire close.
  dialog.addEventListener('close', releaseUrl);

  document.body.appendChild(dialog);
  return dialog;
}

function body(): HTMLElement {
  return ensureDialog().querySelector('[data-viewer-body]') as HTMLElement;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Opens the viewer on one artefact, fetching its bytes. */
export async function openViewer(doc: VaultDocument) {
  const host = ensureDialog();
  releaseUrl();

  const name = host.querySelector('[data-viewer-name]');
  const meta = host.querySelector('[data-viewer-meta]');
  if (name) name.textContent = doc.name;
  if (meta) {
    meta.textContent = [doc.caption, formatBytes(doc.size)].filter(Boolean).join(' · ');
  }
  body().innerHTML = '<p class="py-12 text-sm text-ink-muted">Loading…</p>';

  if (!host.open) host.showModal();

  const kind = renderKindFor(doc.mime, doc.name);
  if (kind === 'unsupported') {
    body().innerHTML = `<p class="max-w-[40ch] py-12 text-center text-sm text-ink-muted">
      No preview for ${escapeHtml(doc.mime || 'this file type')}. It is still stored, and it still
      goes into your export.
    </p>`;
    return;
  }

  try {
    const bytes = await documentBytes(doc.id);
    // Copy into a fresh ArrayBuffer so the Blob owns its own memory.
    const blob = new Blob([bytes.slice()], { type: doc.mime || 'application/octet-stream' });
    objectUrl = URL.createObjectURL(blob);

    body().innerHTML =
      kind === 'image'
        ? `<img src="${objectUrl}" alt="${escapeHtml(doc.name)}"
             class="max-h-[70vh] w-auto max-w-full object-contain" />`
        : `<iframe src="${objectUrl}" title="${escapeHtml(doc.name)}"
             class="h-[70vh] w-full border-0 bg-white"></iframe>`;
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    body().innerHTML = `<p class="max-w-[46ch] py-12 text-center text-sm text-critical">
      Could not open this artefact: ${escapeHtml(describeError(error))}
    </p>`;
  }
}

/**
 * Delegated opener. Any element carrying `data-view="<document id>"` inside
 * `root` opens the viewer, so a re-rendered list needs no rebinding.
 */
export function wireViewer(root: HTMLElement, find: (id: string) => VaultDocument | undefined) {
  root.addEventListener('click', (event) => {
    const trigger = (event.target as HTMLElement).closest<HTMLElement>('[data-view]');
    if (!trigger) return;
    const doc = find(trigger.dataset.view ?? '');
    if (!doc) return;
    event.preventDefault();
    void openViewer(doc);
  });
}
