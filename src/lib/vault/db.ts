/**
 * Browser-local storage for the portfolio builder.
 *
 * IMPORTANT: everything here lives in IndexedDB in the visitor's browser. There
 * is no server. Data does not sync between devices and is lost if the user
 * clears site data. The UI states this plainly, and PDF export is the backup
 * path.
 *
 * FUTURE: to make portfolios durable and shareable, keep this module's
 * signatures and swap the implementation for calls to a Cloudflare Worker
 * backed by R2 (blobs) and D1 (metadata). Every function is already async and
 * every caller awaits, so the seam holds.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { VaultDocument, VaultFolder, VaultProfile } from './types';

const DB_NAME = 'profolio-vault';
const DB_VERSION = 1;
const FOLDERS = 'folders';
const DOCUMENTS = 'documents';
const META = 'meta';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db() {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(FOLDERS)) {
        const store = database.createObjectStore(FOLDERS, { keyPath: 'id' });
        store.createIndex('parentId', 'parentId');
      }
      if (!database.objectStoreNames.contains(DOCUMENTS)) {
        const store = database.createObjectStore(DOCUMENTS, { keyPath: 'id' });
        store.createIndex('folderId', 'folderId');
      }
      if (!database.objectStoreNames.contains(META)) {
        database.createObjectStore(META);
      }
    },
  });
  return dbPromise;
}

export function newId(): string {
  return crypto.randomUUID();
}

/* ---------------------------------------------------------------- folders */

export async function listFolders(): Promise<VaultFolder[]> {
  const all = (await (await db()).getAll(FOLDERS)) as VaultFolder[];
  return all.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export async function createFolder(name: string, parentId: string | null = null): Promise<VaultFolder> {
  const siblings = (await listFolders()).filter((folder) => folder.parentId === parentId);
  const folder: VaultFolder = {
    id: newId(),
    name,
    parentId,
    note: '',
    createdAt: Date.now(),
    order: siblings.length,
  };
  await (await db()).put(FOLDERS, folder);
  return folder;
}

export async function updateFolder(id: string, patch: Partial<VaultFolder>): Promise<void> {
  const database = await db();
  const existing = (await database.get(FOLDERS, id)) as VaultFolder | undefined;
  if (!existing) return;
  await database.put(FOLDERS, { ...existing, ...patch, id });
}

/**
 * Deletes a folder, everything nested inside it, and all documents within.
 * Returns the number of documents removed so the caller can confirm honestly.
 */
export async function deleteFolderDeep(id: string): Promise<number> {
  const folders = await listFolders();
  const doomed = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
        doomed.add(folder.id);
        grew = true;
      }
    }
  }

  const database = await db();
  const documents = (await database.getAll(DOCUMENTS)) as VaultDocument[];
  const removing = documents.filter((doc) => doc.folderId && doomed.has(doc.folderId));

  const tx = database.transaction([FOLDERS, DOCUMENTS], 'readwrite');
  for (const folderId of doomed) tx.objectStore(FOLDERS).delete(folderId);
  for (const doc of removing) tx.objectStore(DOCUMENTS).delete(doc.id);
  await tx.done;

  return removing.length;
}

/* -------------------------------------------------------------- documents */

export async function listDocuments(): Promise<VaultDocument[]> {
  const all = (await (await db()).getAll(DOCUMENTS)) as VaultDocument[];
  return all.sort((a, b) => a.order - b.order || a.addedAt - b.addedAt);
}

export async function addDocument(file: File, folderId: string | null): Promise<VaultDocument> {
  const siblings = (await listDocuments()).filter((doc) => doc.folderId === folderId);
  const doc: VaultDocument = {
    id: newId(),
    name: file.name,
    folderId,
    mime: file.type,
    size: file.size,
    caption: '',
    addedAt: Date.now(),
    order: siblings.length,
    blob: file,
  };
  await (await db()).put(DOCUMENTS, doc);
  return doc;
}

export async function updateDocument(id: string, patch: Partial<VaultDocument>): Promise<void> {
  const database = await db();
  const existing = (await database.get(DOCUMENTS, id)) as VaultDocument | undefined;
  if (!existing) return;
  await database.put(DOCUMENTS, { ...existing, ...patch, id });
}

export async function deleteDocument(id: string): Promise<void> {
  await (await db()).delete(DOCUMENTS, id);
}

/* ------------------------------------------------------------------ meta */

const PROFILE_KEY = 'profile';

export const emptyProfile: VaultProfile = { name: '', title: '', summary: '' };

export async function getProfile(): Promise<VaultProfile> {
  const stored = (await (await db()).get(META, PROFILE_KEY)) as VaultProfile | undefined;
  return { ...emptyProfile, ...stored };
}

export async function saveProfile(profile: VaultProfile): Promise<void> {
  await (await db()).put(META, profile, PROFILE_KEY);
}

/** Wipes the whole vault. Used by the "clear everything" control. */
export async function clearAll(): Promise<void> {
  const database = await db();
  const tx = database.transaction([FOLDERS, DOCUMENTS, META], 'readwrite');
  await Promise.all([
    tx.objectStore(FOLDERS).clear(),
    tx.objectStore(DOCUMENTS).clear(),
    tx.objectStore(META).clear(),
  ]);
  await tx.done;
}

/** Rough storage usage, when the browser exposes it. */
export async function estimateUsage(): Promise<{ used: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { used: usage, quota };
}
