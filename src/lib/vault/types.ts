/**
 * Types for the generic (industry-neutral) portfolio builder.
 *
 * Deliberately separate from the teaching-portfolio types in src/types.ts:
 * that module models a fixed, authored sequence read from JSON at build time,
 * while this one models user-created content stored in D1 and R2.
 *
 * These shapes are the API contract — they match what /api/vault returns.
 */

import type { Dimensions } from './dimensions';

/** A folder. `parentId` of null means it sits at the top level. */
export interface VaultFolder {
  id: string;
  name: string;
  parentId: string | null;
  /** Free-text description shown under the heading in the exported PDF. */
  note: string;
  createdAt: number;
  /** Manual sort position within its parent. */
  order: number;
}

/**
 * An uploaded document's metadata. The bytes live in R2 and are fetched
 * separately from /api/documents/[id]/content, so a portfolio with 200 files
 * still loads as one small JSON response.
 */
export interface VaultDocument extends Dimensions {
  id: string;
  name: string;
  /** Folder it lives in, or null for the top level. */
  folderId: string | null;
  /** MIME type as reported by the browser; may be '' for unknown types. */
  mime: string;
  size: number;
  /** Caption shown beneath the document in the exported PDF. */
  caption: string;
  addedAt: number;
  order: number;
  /**
   * Programmes this record has been assigned to, set by the user when tagging.
   * Never inferred: a programme's contents must not change on its own.
   */
  programmes: string[];
}

/** Owner details printed on the exported PDF cover page. */
export interface VaultProfile {
  name: string;
  title: string;
  summary: string;
}

/** How a document is treated by the PDF exporter. */
export type RenderKind = 'image' | 'pdf' | 'unsupported';

export function renderKindFor(mime: string, name: string): RenderKind {
  const lower = name.toLowerCase();
  if (mime.startsWith('image/')) {
    // pdf-lib can only embed PNG and JPEG.
    if (/(png|jpe?g)$/.test(lower) || /png|jpeg/.test(mime)) return 'image';
    return 'unsupported';
  }
  if (mime === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  return 'unsupported';
}
