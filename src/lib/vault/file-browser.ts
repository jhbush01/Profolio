/**
 * The folder browser, shared by a project's Evidence tab and the Artefacts page.
 *
 * One filing cabinet, opened from two places. Inside a project you see that
 * project's records; on the Artefacts page you see all of them. The folders,
 * the breadcrumb, the drop zone and the rows are the same in both, because they
 * are the same folders — a record has one folder and any number of projects.
 *
 * This replaced a grid of cards. Cards are for browsing things you are choosing
 * between; a placement's evidence is a hundred files you are looking *for*, and
 * a list with a folder above it finds one in a second where a tile grid makes
 * you scroll past sixty.
 *
 * Rendering only. The pages own their state and their event wiring; this owns
 * what a folder and a file look like, so the two pages cannot drift apart.
 */
import { isComplete } from './dimensions';
import { renderKindFor } from './types';
import type { VaultDocument, VaultFolder } from './types';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A short word for what a file is, for the row beside its name. */
export function kindLabel(doc: VaultDocument): string {
  const kind = renderKindFor(doc.mime, doc.name);
  if (kind === 'video') return 'Video';
  if (kind === 'audio') return 'Audio';
  if (kind === 'pdf') return 'PDF';
  if (kind === 'image') return 'Image';
  const extension = /\.([a-z0-9]+)$/i.exec(doc.name)?.[1];
  return extension ? extension.toUpperCase() : 'File';
}

export interface BrowserOptions {
  folders: VaultFolder[];
  /** Every record the viewer owns. Used for the "elsewhere" counts. */
  allDocuments: VaultDocument[];
  /** The records this view is about: a project's, or all of them. */
  scoped: VaultDocument[];
  /** Open folder, null for the top level. */
  cursor: string | null;
  /** Read-only: a closed project, where nothing may be added or moved. */
  frozen: boolean;
  /** Counts how many records in a folder belong to other projects. */
  showElsewhere: boolean;
}

export function childFolders(folders: VaultFolder[], parentId: string | null): VaultFolder[] {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** Descendant folder ids of `id`, including `id` itself. */
export function folderSubtree(folders: VaultFolder[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let added = true;
  while (added) {
    added = false;
    for (const folder of folders) {
      if (folder.parentId && out.has(folder.parentId) && !out.has(folder.id)) {
        out.add(folder.id);
        added = true;
      }
    }
  }
  return out;
}

/** Records in a folder or anywhere beneath it: in scope, and in total. */
export function folderCounts(
  options: Pick<BrowserOptions, 'folders' | 'allDocuments' | 'scoped'>,
  id: string,
): { mine: number; total: number } {
  const subtree = folderSubtree(options.folders, id);
  const inside = (doc: VaultDocument) => doc.folderId !== null && subtree.has(doc.folderId);
  return {
    mine: options.scoped.filter(inside).length,
    total: options.allDocuments.filter(inside).length,
  };
}

/** Trail from the root to the open folder, root first. */
export function breadcrumbTrail(folders: VaultFolder[], cursor: string | null): VaultFolder[] {
  const trail: VaultFolder[] = [];
  let current = folders.find((folder) => folder.id === cursor);
  while (current) {
    trail.unshift(current);
    const parent: string | null = current.parentId;
    current = parent ? folders.find((folder) => folder.id === parent) : undefined;
  }
  return trail;
}

export function breadcrumbHtml(folders: VaultFolder[], cursor: string | null, rootLabel: string): string {
  const trail = breadcrumbTrail(folders, cursor);
  return [
    `<button type="button" data-open-folder="" class="rounded px-1 transition hover:text-accent ${
      cursor === null ? 'font-semibold text-ink' : ''
    }">${escapeHtml(rootLabel)}</button>`,
    ...trail.map(
      (folder, index) =>
        `<span class="text-ink-faint" aria-hidden="true">/</span>
         <button type="button" data-open-folder="${folder.id}" class="rounded px-1 transition hover:text-accent ${
           index === trail.length - 1 ? 'font-semibold text-ink' : ''
         }">${escapeHtml(folder.name)}</button>`,
    ),
  ].join('');
}

export function folderRow(options: BrowserOptions, folder: VaultFolder): string {
  const counts = folderCounts(options, folder.id);
  const elsewhere = counts.total - counts.mine;

  return `<li class="flex items-center gap-3 border-t border-line-subtle py-2.5">
    <span aria-hidden="true" class="shrink-0 text-ink-faint">▸</span>
    <button type="button" data-open-folder="${folder.id}"
      class="min-w-0 flex-1 truncate text-left text-sm font-medium transition hover:text-accent hover:underline">
      ${escapeHtml(folder.name)}
    </button>
    <span class="shrink-0 font-mono text-xs text-ink-faint">
      ${counts.mine}${options.showElsewhere && elsewhere > 0 ? ` · ${elsewhere} from other projects` : ''}
    </span>
    ${
      options.frozen
        ? ''
        : `<span class="flex shrink-0 gap-2">
             <button type="button" data-rename-folder="${folder.id}"
               class="text-xs text-ink-faint underline underline-offset-2 hover:text-accent">Rename</button>
             <button type="button" data-delete-folder="${folder.id}"
               class="text-xs text-ink-faint underline underline-offset-2 hover:text-critical">Delete</button>
           </span>`
    }
  </li>`;
}

export function fileRow(doc: VaultDocument, frozen: boolean, extra = ''): string {
  return `<li class="flex items-center gap-3 border-t border-line-subtle py-2.5">
    <span class="min-w-0 flex-1">
      <button type="button" data-view="${doc.id}" title="${escapeHtml(doc.name)}"
        class="block max-w-full truncate text-left text-sm font-medium transition hover:text-accent hover:underline">
        ${escapeHtml(doc.name)}
      </button>
      <span class="mt-0.5 block text-xs text-ink-faint">
        <span class="font-mono">${escapeHtml(kindLabel(doc))} · ${escapeHtml(fileSize(doc.size))} · ${escapeHtml(shortDate(doc.addedAt))}</span>${
          isComplete(doc) ? '' : ' · <span class="text-caution">needs detail</span>'
        }${extra ? ` · ${extra}` : ''}
      </span>
    </span>
    ${
      frozen
        ? ''
        : `<span class="flex shrink-0 gap-2">
             <button type="button" data-details="${doc.id}"
               class="text-xs text-ink-faint underline underline-offset-2 hover:text-accent">Details</button>
             <button type="button" data-move="${doc.id}"
               class="text-xs text-ink-faint underline underline-offset-2 hover:text-accent">Move</button>
           </span>`
    }
  </li>`;
}

/**
 * The drop target.
 *
 * Scoped to its own box, never the whole window. A full-page overlay that
 * appeared on any drag — including dragging a row to reorder it — was the app
 * fighting the user: it covered the page, it had no way out, and it fired on a
 * gesture that had nothing to do with uploading.
 */
export function dropZone(where: string, frozen: boolean, acknowledged: boolean): string {
  if (frozen) {
    return `<p class="rounded-lg border border-dashed border-line bg-canvas px-4 py-3 text-xs text-ink-muted">
      This project is closed. Reopen it in Settings to add files.
    </p>`;
  }

  if (!acknowledged) {
    return `<div class="rounded-lg border border-dashed border-caution bg-caution-surface px-4 py-3">
      <p class="text-xs text-caution">
        Read and accept the de-identification notice before your first upload.
      </p>
      <a href="/capture" class="mt-2 inline-block text-xs font-medium text-accent hover:underline">Read it</a>
    </div>`;
  }

  return `<div data-drop
    class="rounded-lg border border-dashed border-line bg-canvas px-4 py-5 text-center transition">
    <p class="text-sm font-medium">Drop files here</p>
    <p class="prose-body mx-auto mt-1 max-w-[46ch] text-xs">
      Any number, any type, straight into ${escapeHtml(where)}.
    </p>
    <label class="mt-3 inline-block cursor-pointer rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90">
      Choose files
      <input type="file" multiple data-upload class="sr-only" />
    </label>
  </div>`;
}

/**
 * Asks which folder to move a record into.
 *
 * A numbered prompt rather than a drag target: dragging a row onto a folder is
 * fine with a mouse and impossible with a thumb, and this app is used on a
 * phone in a corridor. Returns the folder id, null for the top level, or
 * undefined when the user backed out or typed something that was not on the list.
 */
export function pickFolder(folders: VaultFolder[], doc: VaultDocument): string | null | undefined {
  const flat: { id: string | null; label: string }[] = [{ id: null, label: 'Top level' }];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of childFolders(folders, parentId)) {
      flat.push({ id: folder.id, label: `${'— '.repeat(depth)}${folder.name}` });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);

  const menu = flat.map((entry, index) => `${index + 1}. ${entry.label}`).join('\n');
  const answer = window.prompt(`Move "${doc.name}" to:\n\n${menu}\n\nNumber:`);
  if (answer === null) return undefined;

  return flat[Number(answer.trim()) - 1]?.id;
}
