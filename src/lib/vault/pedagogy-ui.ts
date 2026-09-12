/**
 * My pedagogy.
 *
 * The statement of practice, and — underneath it — what the evidence actually
 * shows about that practice. The second part is the reason this is a page
 * rather than a text box: a philosophy that says "I teach responsively using
 * data" next to a count of how much assessment data is in the portfolio is a
 * claim you can check, which is exactly what an assessor does with it.
 *
 * Nothing here drafts, suggests or completes a sentence. See docs/PRODUCT.md.
 */
import {
  describeError,
  isAuthError,
  loadProgrammes,
  loadVault,
  reloadForAuth,
  saveProfile,
  type Programme,
} from './db';
import { CYCLE_PHASES } from './dimensions';
import { templateFor } from '../programmes';
import type { VaultDocument, VaultProfile } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

let profile: VaultProfile | null = null;

function setStatus(message: string) {
  const host = $('pedagogy-status');
  if (host) host.textContent = message;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * What the portfolio holds, arranged the way the statement above it talks about
 * practice: by stage of the teaching cycle, then by the standards it touches.
 *
 * Counts only. No score, no percentage, no judgement — this says what is there,
 * and the reader decides whether it backs up what they have just read.
 */
function evidenceBlock(documents: VaultDocument[], programmes: Programme[]): string {
  if (documents.length === 0) {
    return `<h2 class="text-base font-semibold">What your evidence shows</h2>
      <p class="prose-body mt-2 text-sm">
        Nothing captured yet. Once there is evidence, this says what it covers.
      </p>`;
  }

  const phases = CYCLE_PHASES.map((phase) => ({
    label: phase.label,
    count: documents.filter((doc) => doc.cyclePhase === phase.value).length,
  }));

  const standards = new Map<string, number>();
  for (const doc of documents) {
    for (const code of doc.standards) standards.set(code, (standards.get(code) ?? 0) + 1);
  }
  const topStandards = [...standards.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12);

  const unset = documents.filter((doc) => !doc.cyclePhase).length;

  const projectRows = programmes
    .map((programme) => {
      const held = documents.filter((doc) => doc.programmes.includes(programme.id)).length;
      const name = templateFor(programme.template)?.name ?? 'Project';
      return `<div class="flex items-baseline justify-between gap-3 border-t border-line-subtle py-2">
        <a href="/project?id=${encodeURIComponent(programme.id)}" class="min-w-0 truncate text-sm font-medium transition hover:text-accent hover:underline">
          ${escapeHtml(programme.name)}
        </a>
        <span class="shrink-0 font-mono text-xs text-ink-faint">${escapeHtml(name)} · ${held}</span>
      </div>`;
    })
    .join('');

  return `<h2 class="text-base font-semibold">What your evidence shows</h2>
    <p class="prose-body mt-1 text-xs">
      ${documents.length} file${documents.length === 1 ? '' : 's'} across ${programmes.length} project${
        programmes.length === 1 ? '' : 's'
      }${unset > 0 ? ` · ${unset} not yet placed in the cycle` : ''}
    </p>

    <div class="mt-4 grid gap-2 sm:grid-cols-5">
      ${phases
        .map(
          (phase) => `<div class="rounded-md bg-canvas px-3 py-2.5">
            <p class="font-mono text-lg">${phase.count}</p>
            <p class="mt-0.5 text-xs text-ink-muted">${escapeHtml(phase.label)}</p>
          </div>`,
        )
        .join('')}
    </div>

    ${
      topStandards.length > 0
        ? `<div class="mt-5">
             <p class="pf-eyebrow text-ink-faint">Standards your evidence touches</p>
             <div class="mt-2 flex flex-wrap gap-1.5">
               ${topStandards
                 .map(
                   ([code, count]) =>
                     `<span class="rounded-sm border border-line px-2 py-0.5 font-mono text-xs text-ink-muted">
                        ${escapeHtml(code)} <span class="text-ink-faint">${count}</span>
                      </span>`,
                 )
                 .join('')}
             </div>
           </div>`
        : ''
    }

    ${projectRows ? `<div class="mt-5">${projectRows}</div>` : ''}`;
}

export async function initPedagogy() {
  const field = $<HTMLTextAreaElement>('pedagogy-philosophy');
  const counter = $('philosophy-count');
  if (!field) return;

  const showCount = () => {
    if (!counter) return;
    const words = countWords(field.value);
    counter.textContent = words === 0 ? '' : `${words} word${words === 1 ? '' : 's'}`;
  };

  field.addEventListener('input', showCount);

  // Saved on blur, like everything else in the app. A statement of practice is
  // written over weeks in short sittings, and a Save button is one more thing
  // to forget before closing the tab.
  field.addEventListener('change', async () => {
    if (!profile) return;
    try {
      profile = { ...profile, philosophy: field.value };
      await saveProfile(profile);
      setStatus('Saved.');
    } catch (error) {
      if (isAuthError(error) && reloadForAuth()) return;
      setStatus(`Saving failed: ${describeError(error)}`);
    }
  });

  try {
    const [snapshot, programmeData] = await Promise.all([loadVault(), loadProgrammes()]);
    profile = snapshot.profile;
    field.value = snapshot.profile.philosophy;
    showCount();

    const host = $('pedagogy-evidence');
    if (host) {
      host.innerHTML = evidenceBlock(
        snapshot.documents,
        programmeData.programmes.filter((p) => !p.archived),
      );
    }
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    setStatus(`Could not load this: ${describeError(error)}`);
  }
}
