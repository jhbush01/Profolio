/**
 * Client controller for the data-collection profile page.
 *
 * Read-only: it renders the table from the vault snapshot and links each row
 * back to the record it came from. Editing happens in the builder, so there is
 * exactly one place a dimension can be changed.
 */
import { describeError, isAuthError, loadVault, reloadForAuth } from './db';
import {
  BLANK,
  buildProfileRows,
  incompleteCount,
  PROFILE_COLUMNS,
  rowCells,
} from './profile-table';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export async function initProfileTable() {
  const host = $('profile-table');
  const notice = $('profile-notice');
  const meta = $('profile-meta');
  if (!host) return;

  try {
    const snapshot = await loadVault();
    const rows = buildProfileRows(snapshot.documents);

    if (meta) {
      const owner = snapshot.profile.name || snapshot.signedInAs;
      meta.textContent = `${owner} · ${rows.length} record${rows.length === 1 ? '' : 's'}`;
    }

    if (rows.length === 0) {
      host.innerHTML = `<p class="rounded-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-ink-muted">
        Nothing to summarise yet. Add evidence in the
        <a href="/portfolio" class="text-accent underline underline-offset-2">portfolio builder</a>,
        then come back.
      </p>`;
      if (notice) notice.hidden = true;
      return;
    }

    const missing = incompleteCount(rows);
    if (notice) {
      notice.hidden = missing === 0;
      notice.innerHTML = `<strong class="font-medium">${missing} record${missing === 1 ? '' : 's'}</strong>
        ${missing === 1 ? 'is' : 'are'} missing detail, shown as “${BLANK}” below.
        Fill the gaps in the
        <a href="/portfolio" class="underline underline-offset-2">portfolio builder</a>.`;
    }

    const head = PROFILE_COLUMNS.map(
      (column) =>
        `<th scope="col" class="whitespace-nowrap border-b border-line px-3 py-2 text-left font-semibold">${escapeHtml(column)}</th>`,
    ).join('');

    const body = rows
      .map((row) => {
        const cells = rowCells(row)
          .map(
            (cell) =>
              `<td class="border-b border-line px-3 py-2 align-top ${cell === BLANK ? 'text-ink-muted' : ''}">${escapeHtml(cell)}</td>`,
          )
          .join('');
        return `<tr class="${row.complete ? '' : 'bg-caution-surface/50'}">
          <th scope="row" class="border-b border-line px-3 py-2 text-left align-top font-normal">
            <span class="block max-w-[16rem] truncate" title="${escapeHtml(row.documentName)}">${escapeHtml(row.documentName)}</span>
          </th>
          ${cells}
        </tr>`;
      })
      .join('');

    host.innerHTML = `<div class="overflow-x-auto rounded-lg border border-line bg-surface">
      <table class="w-full border-collapse text-xs">
        <thead class="bg-canvas text-ink">
          <tr>
            <th scope="col" class="whitespace-nowrap border-b border-line px-3 py-2 text-left font-semibold">Record</th>
            ${head}
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    host.innerHTML = `<p class="rounded-lg border border-line bg-surface p-6 text-sm text-critical">
      Could not load your records: ${escapeHtml(describeError(error))}
    </p>`;
  }
}
