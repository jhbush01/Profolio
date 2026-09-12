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
    await guard('Saving your picture', async () => {
      await uploadAvatar(file);
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
}
