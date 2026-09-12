/**
 * Client for the portfolio API.
 *
 * Replaces the previous IndexedDB implementation: documents now live in R2 and
 * their metadata in D1, behind Cloudflare Access. The exported function names
 * are unchanged from the browser-storage version, which is why the UI layer
 * needed almost no edits.
 */
import type { VaultDocument, VaultFolder, VaultProfile } from './types';

export const emptyProfile: VaultProfile = {
  name: '',
  title: '',
  summary: '',
  philosophy: '',
  contactEmail: '',
  contactPhone: '',
  contactLocation: '',
  contactLinks: '',
};

/** Thrown when the API rejects a call; `status` lets the UI treat 401 specially. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** True for the two statuses that mean Access did not let this through. */
export function isAuthError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

const AUTH_FAILED_MESSAGE =
  'your sign-in could not be verified. Reload to try again. If it keeps happening, ' +
  'the Access policy in front of this app needs checking.';

/**
 * Readable text for any thrown value, with a useful line for auth failures.
 *
 * Every caller puts this after a colon ("Could not load this project: …",
 * "Saving failed: …"), which is why the auth sentence starts lower case.
 */
export function describeError(error: unknown): string {
  if (isAuthError(error)) return AUTH_FAILED_MESSAGE;
  return error instanceof Error ? error.message : String(error);
}

const AUTH_RELOAD_KEY = 'profolio:auth-reloads';
const AUTH_RELOAD_WINDOW_MS = 60_000;
const AUTH_RELOAD_LIMIT = 2;

/** sessionStorage, or null where touching it throws (private mode, blocked site data). */
function sessionStore(): Storage | null {
  try {
    const store = window.sessionStorage;
    const probe = '__profolio_probe__';
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return null;
  }
}

/**
 * Recover from an expired Access session by reloading: Access intercepts the
 * navigation, the user signs in, and the app comes back.
 *
 * That only works while Access is actually in front of the Worker. When it is
 * not — a route that stopped matching, a blocked cookie, `wrangler dev`
 * without ACCESS_DEV_BYPASS — the reload lands on the same 401 and the page
 * reloads forever, hammering the API and never telling the user why.
 *
 * So reloads are counted in sessionStorage (per tab, gone when the tab closes)
 * and stop after AUTH_RELOAD_LIMIT inside a minute. Returns true if a reload
 * has started and the caller should stop; false means show the error instead.
 * Without usable storage there is no way to count, and an uncounted reload is
 * the loop, so that returns false too.
 */
export function reloadForAuth(): boolean {
  const store = sessionStore();
  if (!store) return false;

  const now = Date.now();
  let recent: number[] = [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(AUTH_RELOAD_KEY) ?? '[]');
    if (Array.isArray(parsed)) {
      recent = parsed.filter(
        (at): at is number => typeof at === 'number' && now - at < AUTH_RELOAD_WINDOW_MS,
      );
    }
  } catch {
    // A corrupted value should not disable recovery: treat it as no attempts.
  }

  if (recent.length >= AUTH_RELOAD_LIMIT) return false;

  store.setItem(AUTH_RELOAD_KEY, JSON.stringify([...recent, now]));
  window.location.reload();
  return true;
}

/** After any successful request the session works, so the reload budget resets. */
function clearAuthReloads(): void {
  try {
    window.sessionStorage.removeItem(AUTH_RELOAD_KEY);
  } catch {
    // No storage means nothing was recorded to clear.
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // Access sets the CF_Authorization cookie; it must ride along.
    credentials: 'same-origin',
    headers: {
      ...(init?.headers as Record<string, string> | undefined),
      // Without this, an expired Access session answers a fetch with the login
      // page — HTML, status 200 — and the JSON parse below throws a syntax
      // error that never reaches the auth handling. With it, Access returns a
      // real 401 and reloadForAuth can do its job.
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error (e.g. an Access login page); keep the status text.
    }
    throw new ApiError(response.status, message);
  }

  clearAuthReloads();
  return (await response.json()) as T;
}

export interface AccountStorage {
  usedBytes: number;
  limitBytes: number;
}

export interface VaultSnapshot {
  signedInAs: string;
  /** How much of this account's storage allowance is in use. */
  storage: AccountStorage;
  /** Whether this user has acknowledged the de-identification requirement. */
  deidAcknowledged: boolean;
  profile: VaultProfile;
  folders: VaultFolder[];
  documents: VaultDocument[];
}

/** One round trip for the whole vault. */
export function loadVault(): Promise<VaultSnapshot> {
  return request<VaultSnapshot>('/api/vault');
}

/** Records the de-identification acknowledgement, unlocking uploads. */
export function acknowledgeDeid(): Promise<{ acknowledgedAt: number }> {
  return request('/api/acknowledgement', { method: 'PUT' });
}

export function saveProfile(profile: VaultProfile): Promise<{ ok: true }> {
  return request('/api/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
}

export function createFolder(name: string, parentId: string | null = null): Promise<VaultFolder> {
  return request<VaultFolder>('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentId }),
  });
}

export function updateFolder(id: string, patch: { name?: string; note?: string }): Promise<unknown> {
  return request(`/api/folders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function deleteFolderDeep(id: string): Promise<{ documentsRemoved: number }> {
  return request(`/api/folders/${id}`, { method: 'DELETE' });
}

/** Uploads all files in one multipart request rather than one call per file. */
export function addDocuments(files: File[], folderId: string | null): Promise<{ added: VaultDocument[] }> {
  const form = new FormData();
  if (folderId) form.set('folderId', folderId);
  for (const file of files) form.append('files', file);
  return request('/api/documents', { method: 'POST', body: form });
}

export interface DocumentPatch {
  caption?: string;
  folderId?: string | null;
  capturedAt?: number | null;
  cyclePhase?: string | null;
  evidenceType?: string | null;
  purpose?: string | null;
  source?: string | null;
  subjectScope?: string | null;
  selfDesigned?: boolean | null;
  standards?: string[];
  /** The complete set of programmes this record belongs to, not a delta. */
  programmes?: string[];
}

/** Partial update — anything omitted is left untouched on the server. */
export function updateDocument(id: string, patch: DocumentPatch): Promise<unknown> {
  return request(`/api/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function deleteDocument(id: string): Promise<unknown> {
  return request(`/api/documents/${id}`, { method: 'DELETE' });
}

/**
 * Replaces the profile picture. Resized in the browser before it is sent, so
 * a 4MB phone photo becomes a picture the server will accept and the account
 * is never asked to store a full-resolution portrait.
 */
export async function uploadAvatar(file: File): Promise<{ avatarUpdatedAt: number }> {
  const form = new FormData();
  form.set('file', await shrinkImage(file));
  return request('/api/profile/avatar', { method: 'PUT', body: form });
}

export function removeAvatar(): Promise<unknown> {
  return request('/api/profile/avatar', { method: 'DELETE' });
}

/** Longest edge of a stored profile picture. Anything bigger is wasted bytes. */
const AVATAR_EDGE = 512;

/**
 * Downscales and re-encodes to JPEG with a canvas.
 *
 * Returns the original untouched if anything here fails — an unusual image
 * format, a browser without createImageBitmap, a canvas the browser refuses to
 * export. The server still enforces type and size, so the worst case is a
 * rejection with a clear message rather than a broken upload.
 */
async function shrinkImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, AVATAR_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.85),
    );
    if (!blob) return file;
    return new File([blob], 'profile.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

export function clearAll(): Promise<unknown> {
  return request('/api/vault', { method: 'DELETE' });
}

/** Removes the account itself, not just its contents. */
export function deleteAccount(): Promise<unknown> {
  return request('/api/account', { method: 'DELETE' });
}

export interface Programme {
  id: string;
  template: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
  createdAt: number;
  archived: boolean;
  context: Record<string, string>;
  /** Written answers to the template's report prompts, keyed by section. */
  report: Record<string, string>;
  /** Set while closed: nothing joins or leaves until it is reopened. */
  closedAt: number | null;
  reopenedAt: number | null;
}

export function loadProgrammes(): Promise<{ programmes: Programme[] }> {
  return request('/api/programmes');
}

export function createProgramme(input: {
  template: string;
  name: string;
  startsOn: string | null;
  endsOn: string | null;
}): Promise<Programme> {
  return request('/api/programmes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateProgramme(
  id: string,
  patch: {
    name?: string;
    startsOn?: string | null;
    endsOn?: string | null;
    archived?: boolean;
    context?: Record<string, string>;
    report?: Record<string, string>;
    closed?: boolean;
  },
): Promise<unknown> {
  return request(`/api/programmes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function deleteProgramme(id: string): Promise<unknown> {
  return request(`/api/programmes/${id}`, { method: 'DELETE' });
}

/** Persists a new display order. Ids must be in the desired order. */
export function saveOrder(order: { documents?: string[]; folders?: string[] }): Promise<unknown> {
  return request('/api/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order),
  });
}

/** Fetches one document's bytes from R2, for the PDF exporter. */
export async function documentBytes(id: string): Promise<Uint8Array> {
  const response = await fetch(`/api/documents/${id}/content`, { credentials: 'same-origin' });
  if (!response.ok) throw new ApiError(response.status, `Could not read document ${id}`);
  return new Uint8Array(await response.arrayBuffer());
}
