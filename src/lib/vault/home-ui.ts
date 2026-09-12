/**
 * Home — what a signed-in practitioner lands on.
 *
 * A grid of projects, the way a portfolio site presents work, because that is
 * the shape people already know. The two things a portfolio site cannot do are
 * what the cards carry: each one says what is still missing, and opening one
 * shows the evidence organised inside it rather than a flat pile.
 *
 * "Project" is the word on screen for what the code calls a programme. The
 * rename stops at the UI on purpose — routes, API and schema still say
 * programme, and moving those is its own change.
 *
 * Read-only by design: every action here is a link to the page that owns it.
 *
 * Deliberately only the header and the grid. What needs attention, what was
 * captured lately and what a project produces are questions about one project,
 * so they live on that project's Hub tab rather than being averaged across all
 * of them here.
 */
import { describeError, isAuthError, loadProgrammes, loadVault, reloadForAuth, type Programme } from './db';
import { projectCard } from './project-card';
import type { VaultDocument, VaultProfile } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

function initials(profile: VaultProfile, email: string): string {
  const source = profile.name.trim() || email;
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}

/* --------------------------------------------------------------- sections */

/**
 * Who this belongs to.
 *
 * "Home" in the navigation, because that is what a nav link is for. "Your
 * ProFolio" here, because that is what the page is — the two words do different
 * jobs and do not have to match.
 */
function headerBlock(profile: VaultProfile, email: string): string {
  const named = profile.name.trim().length > 0;
  const role = [profile.title.trim(), profile.summary.trim()].filter(Boolean).join(' · ');

  // Capture and Export used to sit beside this. They are in the nav on both
  // phone and desktop now, and a header that repeats the navigation is a
  // header that says nothing about the person it belongs to.
  return `<div class="flex flex-col gap-5">
    <div class="flex min-w-0 flex-1 items-start gap-4">
      <div class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-accent-soft font-display text-2xl text-accent">
        ${
          profile.avatarUpdatedAt
            ? `<img src="/api/profile/avatar?v=${profile.avatarUpdatedAt}" alt="" class="size-full object-cover" />`
            : escapeHtml(initials(profile, email))
        }
      </div>
      <div class="min-w-0 flex-1">
        <p class="pf-eyebrow text-ink-faint">Your ProFolio</p>
        <h1 class="mt-1.5 font-display text-3xl font-normal tracking-[-0.02em] sm:text-5xl ${named ? '' : 'text-ink-faint'}">
          ${escapeHtml(named ? profile.name : 'Your name')}
        </h1>
        ${role ? `<p class="prose-body mt-1 text-sm">${escapeHtml(role)}</p>` : ''}
        <a href="/account" class="mt-1 inline-block text-xs font-medium text-accent hover:underline">
          ${named ? 'Edit cover details' : 'Add cover details'}
        </a>
      </div>
    </div>
  </div>`;
}

/**
 * The grid of projects.
 *
 * Starting one is a button in the section header, not a dashed tile in the
 * grid. A tile that is not a project should not be sitting in the row of
 * projects at project size, and /programmes is where both starting and
 * managing happen anyway.
 */
function projectGrid(programmes: Programme[], documents: VaultDocument[]): string {
  const cards = programmes.map((programme) => projectCard(programme, documents)).join('');

  return `<section class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-4">
      <h2 class="text-xl font-semibold">Your projects</h2>
      <a href="/programmes"
        class="shrink-0 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium transition hover:border-accent/40 hover:text-accent">
        New project
      </a>
    </div>
    ${
      programmes.length === 0
        ? '<p class="prose-body text-sm">No projects yet.</p>'
        : `<div class="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">${cards}</div>`
    }
  </section>`;
}

/** Day one. Says what belongs here and offers the one action that fills it. */
function emptyBlock(hasProgramme: boolean): string {
  return `<section class="flex flex-col items-center gap-4 rounded-lg border border-dashed border-line bg-canvas px-8 py-16 text-center">
    <h2 class="text-xl font-semibold">Nothing recorded yet</h2>
    <p class="prose-body max-w-[52ch] text-sm">
      ${
        hasProgramme
          ? 'Capture evidence and it appears here, dated and assigned to the project you are collecting for.'
          : 'Start a project first: a final placement, a registration year. It comes with a checklist, and evidence you capture has somewhere to go.'
      }
    </p>
    <div class="flex flex-wrap justify-center gap-2">
      ${
        hasProgramme
          ? `<a href="/capture" class="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90">Capture evidence</a>`
          : `<a href="/programmes" class="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90">Start a project</a>
             <a href="/capture" class="rounded-md border border-line bg-surface px-5 py-2.5 text-sm font-medium transition hover:border-accent/40">Capture evidence</a>`
      }
    </div>
    <p class="text-xs text-ink-faint">You can capture now and assign later.</p>
  </section>`;
}

/* ---------------------------------------------------------------- wiring */

export async function initHome() {
  const host = $('home');
  if (!host) return;

  try {
    const [snapshot, programmeData] = await Promise.all([loadVault(), loadProgrammes()]);
    const { documents, profile, signedInAs } = snapshot;
    // Archived projects are put away on purpose; Home is what you are
    // working on. They are still one click away under Projects → Archived.
    const programmes = programmeData.programmes.filter((p) => !p.archived);

    // Home is who you are and what you are building. What still needs doing,
    // what was captured lately and what a project produces are all questions
    // about one project, and they are answered inside it, on its Hub tab.
    const body =
      documents.length === 0 && programmes.length === 0
        ? emptyBlock(false)
        : projectGrid(programmes, documents);

    host.innerHTML = `<div class="flex flex-col gap-8">
      ${headerBlock(profile, signedInAs)}
      ${body}
    </div>`;
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    host.innerHTML = `<p class="card p-6 text-sm text-critical">
      Could not load your ProFolio: ${escapeHtml(describeError(error))}
    </p>`;
  }
}
