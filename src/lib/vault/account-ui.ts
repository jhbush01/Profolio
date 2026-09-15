/**
 * The account page: how your ProFolio presents itself, and how to leave.
 *
 * These used to sit at the top of the evidence page, which meant every trip to
 * find one artefact opened with a form you fill in once. They belong behind
 * the account menu, with the other things you set and forget.
 *
 * Its own controller rather than a branch inside ui.ts: that file renders the
 * folder tree and document list, none of which exists here, and a page whose
 * job is three inputs should not be loading a document library to show them.
 */
import {
  clearAll,
  deleteAccount,
  describeError,
  isAuthError,
  loadVault,
  reloadForAuth,
  removeAvatar,
  saveProfile,
  uploadAvatar,
} from './db';
import type { VaultProfile } from './types';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

function setStatus(message: string) {
  const host = $('account-status');
  if (host) host.textContent = message;
}

async function guard(label: string, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    if (isAuthError(error) && reloadForAuth()) return;
    setStatus(`${label} failed: ${describeError(error)}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * How this person signed in, named the way they would name it.
 *
 * Access serves /cdn-cgi/access/get-identity on every hostname it protects, so
 * no team domain is baked in here — the same reason the sign-out link carries
 * none. Best effort by design: the line stays hidden when the endpoint is not
 * there, which is what happens in local development and what would happen again
 * if the app ever moved off Access. Nothing depends on the answer, because how
 * somebody signed in must never decide what they are allowed to do.
 */
async function showSignInMethod() {
  const host = $('account-method');
  if (!host) return;

  const NAMED: Record<string, string> = {
    google: 'your Google account',
    'google-apps': 'your Google Workspace account',
    github: 'your GitHub account',
    azureAD: 'your Microsoft account',
    linkedin: 'your LinkedIn account',
    onetimepin: 'a code emailed to you',
    otp: 'a code emailed to you',
  };

  try {
    const response = await fetch('/cdn-cgi/access/get-identity', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return;
    const identity = (await response.json()) as { idp?: { type?: string } };
    const label = NAMED[identity.idp?.type ?? ''];
    if (!label) return;
    host.textContent = `Signed in with ${label}.`;
    host.hidden = false;
  } catch {
    // Offline, or not behind Access. Not worth saying anything about.
  }
}

/** Two letters from a name, or from the address when there is no name yet. */
function initialsFrom(name: string, email: string): string {
  const parts = (name.trim() || email).split(/[\s.@_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export async function initAccount() {
  const nameField = $<HTMLInputElement>('profile-name');
  const titleField = $<HTMLInputElement>('profile-title');
  const summaryField = $<HTMLTextAreaElement>('profile-summary');
  const emailField = $('account-page-email');
  const usageField = $('account-usage');

  const philosophyField = $<HTMLTextAreaElement>('profile-philosophy');
  const contactEmailField = $<HTMLInputElement>('contact-email');
  const contactPhoneField = $<HTMLInputElement>('contact-phone');
  const contactLocationField = $<HTMLInputElement>('contact-location');
  const contactLinksField = $<HTMLTextAreaElement>('contact-links');

  const persist = async () => {
    const next: VaultProfile = {
      name: nameField?.value ?? '',
      title: titleField?.value ?? '',
      summary: summaryField?.value ?? '',
      philosophy: philosophyField?.value ?? '',
      contactEmail: contactEmailField?.value ?? '',
      contactPhone: contactPhoneField?.value ?? '',
      contactLocation: contactLocationField?.value ?? '',
      contactLinks: contactLinksField?.value ?? '',
    };
    await guard('Saving cover details', async () => {
      await saveProfile(next);
      setStatus('Saved.');
    });
  };

  // On `change`, not on every keystroke: a PUT per character is a lot of
  // writes to say the same thing.
  for (const field of [
    nameField,
    titleField,
    summaryField,
    philosophyField,
    contactEmailField,
    contactPhoneField,
    contactLocationField,
    contactLinksField,
  ]) {
    field?.addEventListener('change', persist);
  }

  $('clear-all')?.addEventListener('click', async () => {
    if (
      !window.confirm(
        'Delete every file, folder and project, and your cover details? This cannot be undone. Export a PDF first if you want a copy.',
      )
    )
      return;
    await guard('Clearing', async () => {
      await clearAll();
      for (const field of [
        nameField,
        titleField,
        summaryField,
        philosophyField,
        contactEmailField,
        contactPhoneField,
        contactLocationField,
        contactLinksField,
      ]) {
        if (field) field.value = '';
      }
      setStatus('Cleared.');
      await load();
    });
  });

  $('delete-account')?.addEventListener('click', async () => {
    // Typed rather than clicked: this one removes the account, and a confirm
    // dialog is a reflex by the second time you have seen it.
    const typed = window.prompt(
      'This deletes your evidence, your projects and the account itself. It cannot be undone.\n\nType DELETE to confirm.',
    );
    if (typed !== 'DELETE') {
      if (typed !== null) setStatus('Not deleted: the confirmation did not match.');
      return;
    }
    await guard('Deleting account', async () => {
      await deleteAccount();
      // Straight to the ProFolio, which resolves a fresh empty account.
      window.location.href = '/';
    });
  });

  const preview = $('avatar-preview');
  const avatarInput = $<HTMLInputElement>('avatar-input');
  const removeButton = $('avatar-remove');

  function showAvatar(stamp: number | null, name: string, email: string) {
    if (!preview) return;
    if (stamp) {
      // The stamp is the cache-buster: one stable URL, a new query each time
      // the picture is replaced.
      preview.innerHTML = '';
      const img = document.createElement('img');
      img.src = `/api/profile/avatar?v=${stamp}`;
      img.alt = 'Your profile picture';
      img.className = 'size-full object-cover';
      preview.appendChild(img);
    } else {
      preview.textContent = initialsFrom(name, email);
    }
    if (removeButton) removeButton.hidden = !stamp;
  }

  $('avatar-choose')?.addEventListener('click', () => avatarInput?.click());

  avatarInput?.addEventListener('change', async () => {
    const file = avatarInput.files?.[0];
    // Cleared first, so choosing the same file twice still fires a change.
    avatarInput.value = '';
    if (!file) return;

    // Choose the square before it is sent. A landscape photo used to be
    // squashed to fit, which turned a picture of a person into a strip of
    // classroom with a head somewhere in it.
    const { cropImage } = await import('./avatar-crop');
    // The aspect is the shape of the slot it is going into, so what gets
    // positioned is what gets shown.
    const square = await cropImage(file, { aspect: 1, title: 'Position your picture' });
    if (!square) {
      setStatus('Picture not changed.');
      return;
    }

    await guard('Saving your picture', async () => {
      await uploadAvatar(square);
      setStatus('Picture saved.');
      await load();
    });
  });

  removeButton?.addEventListener('click', async () => {
    await guard('Removing your picture', async () => {
      await removeAvatar();
      setStatus('Picture removed.');
      await load();
    });
  });

  async function load() {
    const snapshot = await loadVault();
    if (nameField) nameField.value = snapshot.profile.name;
    if (titleField) titleField.value = snapshot.profile.title;
    if (summaryField) summaryField.value = snapshot.profile.summary;
    if (philosophyField) philosophyField.value = snapshot.profile.philosophy;
    if (contactEmailField) contactEmailField.value = snapshot.profile.contactEmail;
    if (contactPhoneField) contactPhoneField.value = snapshot.profile.contactPhone;
    if (contactLocationField) contactLocationField.value = snapshot.profile.contactLocation;
    if (contactLinksField) contactLinksField.value = snapshot.profile.contactLinks;
    if (emailField) emailField.textContent = snapshot.signedInAs;
    showAvatar(snapshot.profile.avatarUpdatedAt ?? null, snapshot.profile.name, snapshot.signedInAs);
    if (usageField) {
      const used = snapshot.storage.usedBytes;
      usageField.textContent = `${snapshot.documents.length} file${
        snapshot.documents.length === 1 ? '' : 's'
      } · ${formatBytes(used)} of ${formatBytes(snapshot.storage.limitBytes)}`;
    }
  }

  await guard('Loading your account', load);
  // Not inside `guard`, and not awaited with the rest: a provider name is a
  // nicety, and a page that failed to render because of one would be absurd.
  void showSignInMethod();
  void wirePassword();
}

/**
 * Setting or changing the password on the account already signed in.
 *
 * The only route by which an account reached through Google or Cloudflare gains
 * a password, which is what lets sign-up refuse to adopt accounts by email. See
 * password-auth.ts for why that refusal is the thing holding this up.
 */
async function wirePassword() {
  const form = $<HTMLFormElement>('password-form');
  const state = $('password-state');
  const addressField = $<HTMLInputElement>('password-email');
  const currentWrap = $('current-wrap');
  const currentField = $<HTMLInputElement>('password-current');
  const nextField = $<HTMLInputElement>('password-new');
  const save = $<HTMLButtonElement>('password-save');
  const error = $('password-error');
  if (!form || !state || !addressField || !nextField || !save || !error) return;

  let existing: string | null = null;

  try {
    const response = await fetch('/api/auth/password', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('unavailable');
    existing = ((await response.json()) as { email: string | null }).email;
  } catch {
    state.textContent = 'Password sign-in is not available on this deployment.';
    return;
  }

  if (existing) {
    state.textContent = `You can sign in with ${existing} and a password.`;
    addressField.value = existing;
    if (currentWrap) currentWrap.hidden = false;
    save.textContent = 'Change password';
  } else {
    state.textContent =
      'This account has no password yet. Add one and you can sign in without Google or Cloudflare.';
    const signedInAs = $('account-page-email')?.textContent?.trim() ?? '';
    if (signedInAs.includes('@')) addressField.value = signedInAs;
  }
  form.hidden = false;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.hidden = true;
    save.disabled = true;
    const was = save.textContent;
    // PBKDF2 is slow on purpose, so a pause here is the feature working.
    save.textContent = 'Saving…';

    try {
      const response = await fetch('/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: addressField.value.trim(),
          current: currentField?.value ?? '',
          password: nextField.value,
        }),
      });

      if (response.ok) {
        // Every session just ended, including this one. Going anywhere else
        // would show a page that 401s a moment later.
        window.location.href = '/signin';
        return;
      }

      const body = (await response.json().catch(() => ({}))) as { error?: string };
      error.textContent = body.error ?? 'That did not work.';
      error.hidden = false;
    } catch {
      error.textContent = 'Could not reach ProFolio. Check your connection and try again.';
      error.hidden = false;
    } finally {
      save.disabled = false;
      save.textContent = was;
    }
  });
}
