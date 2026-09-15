/**
 * The sign-in page's behaviour.
 *
 * Two modes on one form rather than two forms, because the fields are the same
 * and a browser's password manager copes far better with one stable form than
 * with two that swap places.
 *
 * Nothing here decides anything. The server rejects a weak password, a taken
 * address and a wrong one; this only relays what it said. A client-side check
 * that disagreed with the server would be a rule the user can satisfy and still
 * be refused.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

const SELECTED = 'bg-surface text-ink shadow-[0_1px_2px_rgba(77,51,22,0.08)]';
const UNSELECTED = 'text-ink-muted hover:text-ink';

export function initSignIn() {
  const form = $<HTMLFormElement>('auth-form');
  const email = $<HTMLInputElement>('email');
  const password = $<HTMLInputElement>('password');
  const submit = $<HTMLButtonElement>('submit');
  const error = $('auth-error');
  const hint = $('password-hint');
  const tabIn = $<HTMLButtonElement>('tab-in');
  const tabUp = $<HTMLButtonElement>('tab-up');
  if (!form || !email || !password || !submit || !error || !tabIn || !tabUp) return;

  let creating = false;

  function setMode(next: boolean) {
    creating = next;
    tabIn!.setAttribute('aria-selected', String(!next));
    tabUp!.setAttribute('aria-selected', String(next));
    tabIn!.className = `flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition ${next ? UNSELECTED : SELECTED}`;
    tabUp!.className = `flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition ${next ? SELECTED : UNSELECTED}`;
    submit!.textContent = next ? 'Create account' : 'Sign in';
    // The right autocomplete token, so a manager offers to save a new password
    // on sign-up and to fill the existing one on sign-in.
    password!.setAttribute('autocomplete', next ? 'new-password' : 'current-password');
    if (hint) hint.hidden = !next;
    error!.hidden = true;
  }

  tabIn.addEventListener('click', () => setMode(false));
  tabUp.addEventListener('click', () => setMode(true));
  setMode(false);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;

    if (!email.value.trim() || !password.value) {
      error.textContent = 'Fill in both fields.';
      error.hidden = false;
      return;
    }

    submit.disabled = true;
    const was = submit.textContent;
    // Password hashing is deliberately slow — that is the point of it — so a
    // second of no feedback here is the normal case, not a stall.
    submit.textContent = creating ? 'Creating…' : 'Signing in…';

    try {
      const response = await fetch(creating ? '/api/auth/sign-up' : '/api/auth/sign-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.value.trim(), password: password.value }),
      });

      if (response.ok) {
        // A full navigation, not history.pushState: the session cookie has just
        // been set and every page behind it needs a fresh request to see it.
        window.location.href = '/';
        return;
      }

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      error.textContent = body.error ?? 'That did not work. Try again.';
      error.hidden = false;
    } catch {
      error.textContent = 'Could not reach ProFolio. Check your connection and try again.';
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = was;
    }
  });
}
