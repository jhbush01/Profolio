/**
 * Choosing what a record is evidence OF.
 *
 * The app used to decide this by predicate, every render, from the record's
 * dimensions — and it got it wrong constantly, because the dimensions cannot
 * carry the distinction. A marked summative script is honestly an individual's
 * work sample, honestly assessed, honestly not self-designed, so it lands under
 * "focus student work across the sequence", "marked summative work" AND "record
 * of moderation" at the same time. Which of those the person MEANT is the one
 * thing the file does not know. This dialog asks.
 *
 * Checkboxes rather than one choice, because one record genuinely can answer
 * two items and forcing a single pick would make the app wrong in the other
 * direction. But the common case is a file in the wrong place, so ticking the
 * right item and leaving the rest clear is the whole interaction, and clearing
 * the wrong ones is what makes a move a move.
 *
 * A plain <dialog> on <body>, like the cropper and the viewer, so it escapes
 * whatever scrolled or clipped container it was opened from.
 */
import { escapeHtml } from './file-browser';
import type { ProgrammeTemplate } from '../programmes';

export interface PlaceResult {
  /** The complete new set of checklist item ids. Empty is a real answer. */
  itemIds: string[];
}

/**
 * Opens the picker and resolves with the chosen set, or null if cancelled.
 *
 * `current` is what the record answers now, whether that was chosen or guessed;
 * `guessed` says which of those it was, so the dialog can be honest about
 * whether it is showing a decision or a default.
 */
export function pickPlacement(
  template: ProgrammeTemplate,
  documentName: string,
  current: readonly string[],
  guessed: boolean,
): Promise<PlaceResult | null> {
  const chosen = new Set(current);
  const sections = [...new Set(template.items.map((item) => item.section))];

  const dialog = document.createElement('dialog');
  dialog.className =
    'm-auto w-[min(34rem,94vw)] max-w-none rounded-lg border border-line bg-surface p-0 text-ink ' +
    'backdrop:bg-ink/60 backdrop:backdrop-blur-[1px]';

  const rows = sections
    .map((section) => {
      const items = template.items.filter((item) => item.section === section);
      return `<div class="border-t border-line-subtle first:border-t-0">
        <p class="pf-eyebrow sticky top-0 bg-surface px-5 pb-1 pt-3 text-ink-faint">${escapeHtml(section)}</p>
        ${items
          .map(
            (item) => `<label class="flex cursor-pointer items-start gap-2.5 px-5 py-2 transition hover:bg-canvas/60">
              <input type="checkbox" data-item="${escapeHtml(item.id)}"${
                chosen.has(item.id) ? ' checked' : ''
              } class="mt-0.5 shrink-0" />
              <span class="min-w-0">
                <span class="block text-sm font-medium">${escapeHtml(item.label)}</span>
                <span class="prose-body block text-xs">${escapeHtml(item.detail)}</span>
              </span>
            </label>`,
          )
          .join('')}
      </div>`;
    })
    .join('');

  dialog.innerHTML = `
    <form method="dialog" class="contents">
      <div class="border-b border-line px-5 py-3">
        <h2 class="text-sm font-semibold">What is this evidence of?</h2>
        <p class="prose-body mt-1 truncate text-xs" title="${escapeHtml(documentName)}">${escapeHtml(documentName)}</p>
      </div>

      <p class="prose-body border-b border-line-subtle bg-canvas/50 px-5 py-2.5 text-xs">
        ${
          guessed
            ? 'Ticked below is where ProFolio guessed this belongs. Correct it and the guess stops — it stays exactly where you put it.'
            : 'Ticked below is where you put this. Change it any time.'
        }
        Tick more than one only if it genuinely answers more than one.
      </p>

      <div class="max-h-[50vh] overflow-y-auto">${rows}</div>

      <div class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" data-none
          class="mr-auto rounded-md px-2 py-1.5 text-xs text-ink-faint underline underline-offset-2 transition hover:text-ink">
          None of these
        </button>
        <button value="cancel" class="rounded-md px-3 py-1.5 text-sm font-medium text-ink-muted transition hover:text-ink">Cancel</button>
        <button value="save" class="pf-press rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white transition hover:opacity-90">Save</button>
      </div>
    </form>`;

  document.body.appendChild(dialog);

  dialog.addEventListener('change', (event) => {
    const box = (event.target as HTMLElement).closest('input[data-item]') as HTMLInputElement | null;
    if (!box) return;
    if (box.checked) chosen.add(box.dataset.item!);
    else chosen.delete(box.dataset.item!);
  });

  dialog.querySelector('[data-none]')?.addEventListener('click', () => {
    chosen.clear();
    for (const box of dialog.querySelectorAll<HTMLInputElement>('input[data-item]')) {
      box.checked = false;
    }
  });

  dialog.showModal();

  return new Promise((resolve) => {
    dialog.addEventListener(
      'close',
      () => {
        const choice = dialog.returnValue;
        dialog.remove();
        resolve(choice === 'save' ? { itemIds: [...chosen] } : null);
      },
      { once: true },
    );
  });
}
