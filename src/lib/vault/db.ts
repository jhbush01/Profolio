/**
 * Client for the portfolio API.
 *
 * Replaces the previous IndexedDB implementation: documents now live in R2 and
 * their metadata in D1, behind Cloudflare Access. The exported function names
 * are unchanged from the browser-storage version, which is why the UI layer
 * needed almost no edits.
 */
import type { VaultDocument, VaultFolder, VaultProfile } from './types';

export const emptyProfile: VaultProfile = { name: '', title: '', summary: '' };

/** Thrown when the API rejects a call; `status` lets the UI treat 401 specially. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    // Access sets the CF_Authorization cookie; it must ride along.
    credentials: 'same-origin',
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

  return (await response.json()) as T;
}

export interface VaultSnapshot {
  signedInAs: string;
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

export function updateDocument(
  id: string,
  patch: { caption?: string; folderId?: string | null },
): Promise<unknown> {
  return request(`/api/documents/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export function deleteDocument(id: string): Promise<unknown> {
  return request(`/api/documents/${id}`, { method: 'DELETE' });
}

export function clearAll(): Promise<unknown> {
  return request('/api/vault', { method: 'DELETE' });
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
