/**
 * D1 + R2 data access, scoped to one owner.
 *
 * Every query filters on `owner`, so a bug in a route handler cannot leak one
 * user's documents to another even once this becomes multi-user.
 */
import { HttpError, type Identity } from './access';
import type { Dimensions } from '../vault/dimensions';

export interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
  note: string;
  createdAt: number;
  order: number;
}

export interface DocumentRow extends Dimensions {
  id: string;
  name: string;
  folderId: string | null;
  mime: string;
  size: number;
  caption: string;
  addedAt: number;
  order: number;
}

export interface ProfileRow {
  name: string;
  title: string;
  summary: string;
}

export interface ProgrammeRow {
  id: string;
  template: string;
  name: string;
  /** ISO date, YYYY-MM-DD, or null when not set yet. */
  startsOn: string | null;
  endsOn: string | null;
  createdAt: number;
  archived: boolean;
}

/** Accepts only YYYY-MM-DD; anything else becomes null rather than corrupt data. */
function isoDateOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return Number.isFinite(Date.parse(`${trimmed}T00:00:00Z`)) ? trimmed : null;
}

/** Fields a caller may change on a document. Anything omitted is left alone. */
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
}

/** Blank strings from a cleared <select> mean "unset", not an empty value. */
function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : value;
  return trimmed ? trimmed : null;
}

/** Tolerates legacy nulls and anything malformed rather than throwing. */
function parseStandards(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Largest single upload accepted, to keep one bad file from filling the bucket. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export class Repo {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
    private readonly who: Identity,
  ) {}

  private key(documentId: string): string {
    // Namespaced by owner so bucket objects are attributable and prefix-listable.
    return `${this.who.email}/${documentId}`;
  }

  async folders(): Promise<FolderRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, name, parent_id, note, created_at, sort_order
           FROM folders WHERE owner = ?1
          ORDER BY sort_order, name`,
      )
      .bind(this.who.email)
      .all<Record<string, unknown>>();

    return results.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      parentId: (row.parent_id as string | null) ?? null,
      note: (row.note as string) ?? '',
      createdAt: row.created_at as number,
      order: row.sort_order as number,
    }));
  }

  async documents(): Promise<DocumentRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, name, folder_id, mime, size, caption, added_at, sort_order,
                captured_at, cycle_phase, evidence_type, purpose, source,
                subject_scope, self_designed, standards
           FROM documents WHERE owner = ?1
          ORDER BY sort_order, added_at`,
      )
      .bind(this.who.email)
      .all<Record<string, unknown>>();

    return results.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      folderId: (row.folder_id as string | null) ?? null,
      mime: (row.mime as string) ?? '',
      size: row.size as number,
      caption: (row.caption as string) ?? '',
      addedAt: row.added_at as number,
      order: row.sort_order as number,
      capturedAt: (row.captured_at as number | null) ?? null,
      cyclePhase: (row.cycle_phase as string | null) ?? null,
      evidenceType: (row.evidence_type as string | null) ?? null,
      purpose: (row.purpose as string | null) ?? null,
      source: (row.source as string | null) ?? null,
      subjectScope: (row.subject_scope as string | null) ?? null,
      // Stored as 1/0/NULL; NULL means "not answered yet", which is different
      // from "no".
      selfDesigned:
        row.self_designed === null || row.self_designed === undefined
          ? null
          : Boolean(row.self_designed),
      standards: parseStandards(row.standards),
    }));
  }

  async profile(): Promise<ProfileRow> {
    const row = await this.db
      .prepare(`SELECT name, title, summary FROM profiles WHERE owner = ?1`)
      .bind(this.who.email)
      .first<Record<string, unknown>>();
    return {
      name: (row?.name as string) ?? '',
      title: (row?.title as string) ?? '',
      summary: (row?.summary as string) ?? '',
    };
  }

  /**
   * When this owner acknowledged the de-identification requirement, or null.
   * Uploads are refused until it is set — see POST /api/documents.
   */
  async deidAcknowledgedAt(): Promise<number | null> {
    const row = await this.db
      .prepare(`SELECT deid_ack_at FROM profiles WHERE owner = ?1`)
      .bind(this.who.email)
      .first<{ deid_ack_at: number | null }>();
    return row?.deid_ack_at ?? null;
  }

  /** Records the acknowledgement. Idempotent: the first timestamp stands. */
  async acknowledgeDeid(): Promise<number> {
    const now = Date.now();
    await this.db
      .prepare(
        `INSERT INTO profiles (owner, deid_ack_at) VALUES (?1, ?2)
         ON CONFLICT(owner) DO UPDATE SET deid_ack_at = COALESCE(deid_ack_at, ?2)`,
      )
      .bind(this.who.email, now)
      .run();
    return (await this.deidAcknowledgedAt()) ?? now;
  }

  async saveProfile(profile: ProfileRow): Promise<void> {
    await this.db
      .prepare(
        // Only the cover fields are touched; deid_ack_at is a compliance
        // record and must survive a profile edit.
        `INSERT INTO profiles (owner, name, title, summary) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(owner) DO UPDATE SET name = ?2, title = ?3, summary = ?4`,
      )
      .bind(this.who.email, profile.name, profile.title, profile.summary)
      .run();
  }

  async createFolder(name: string, parentId: string | null): Promise<FolderRow> {
    if (parentId && !(await this.ownsFolder(parentId))) {
      throw new HttpError(404, 'Parent folder not found');
    }
    const siblings = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM folders
          WHERE owner = ?1 AND ((?2 IS NULL AND parent_id IS NULL) OR parent_id = ?2)`,
      )
      .bind(this.who.email, parentId)
      .first<{ n: number }>();

    const folder: FolderRow = {
      id: crypto.randomUUID(),
      name,
      parentId,
      note: '',
      createdAt: Date.now(),
      order: siblings?.n ?? 0,
    };

    await this.db
      .prepare(
        `INSERT INTO folders (id, owner, name, parent_id, note, created_at, sort_order)
         VALUES (?1, ?2, ?3, ?4, '', ?5, ?6)`,
      )
      .bind(folder.id, this.who.email, folder.name, folder.parentId, folder.createdAt, folder.order)
      .run();

    return folder;
  }

  async updateFolder(id: string, patch: { name?: string; note?: string }): Promise<void> {
    if (!(await this.ownsFolder(id))) throw new HttpError(404, 'Folder not found');
    if (patch.name !== undefined) {
      await this.db
        .prepare(`UPDATE folders SET name = ?3 WHERE id = ?1 AND owner = ?2`)
        .bind(id, this.who.email, patch.name)
        .run();
    }
    if (patch.note !== undefined) {
      await this.db
        .prepare(`UPDATE folders SET note = ?3 WHERE id = ?1 AND owner = ?2`)
        .bind(id, this.who.email, patch.note)
        .run();
    }
  }

  /** Deletes a folder, its descendants, and every document inside them. */
  async deleteFolder(id: string): Promise<number> {
    if (!(await this.ownsFolder(id))) throw new HttpError(404, 'Folder not found');

    const all = await this.folders();
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const folder of all) {
        if (folder.parentId && doomed.has(folder.parentId) && !doomed.has(folder.id)) {
          doomed.add(folder.id);
          grew = true;
        }
      }
    }

    const docs = (await this.documents()).filter((doc) => doc.folderId && doomed.has(doc.folderId));

    // R2 first: an orphaned object is worse than a retryable delete, because a
    // row without its object is visible in the UI as a broken document.
    if (docs.length > 0) await this.bucket.delete(docs.map((doc) => this.key(doc.id)));

    const statements = [
      ...docs.map((doc) =>
        this.db.prepare(`DELETE FROM documents WHERE id = ?1 AND owner = ?2`).bind(doc.id, this.who.email),
      ),
      ...[...doomed].map((folderId) =>
        this.db.prepare(`DELETE FROM folders WHERE id = ?1 AND owner = ?2`).bind(folderId, this.who.email),
      ),
    ];
    await this.db.batch(statements);

    return docs.length;
  }

  async addDocument(file: File, folderId: string | null): Promise<DocumentRow> {
    // Server-side gate. The UI blocks this too, but a client cannot be the
    // only thing standing between children's work and a public bucket.
    if ((await this.deidAcknowledgedAt()) === null) {
      throw new HttpError(403, 'Acknowledge the de-identification requirement before uploading');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(
        413,
        `"${file.name}" is larger than the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`,
      );
    }
    if (folderId && !(await this.ownsFolder(folderId))) throw new HttpError(404, 'Folder not found');

    const siblings = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM documents
          WHERE owner = ?1 AND ((?2 IS NULL AND folder_id IS NULL) OR folder_id = ?2)`,
      )
      .bind(this.who.email, folderId)
      .first<{ n: number }>();

    const doc: DocumentRow = {
      id: crypto.randomUUID(),
      name: file.name,
      folderId,
      mime: file.type,
      size: file.size,
      caption: '',
      addedAt: Date.now(),
      order: siblings?.n ?? 0,
      // Dimensions are added later; see docs/PRODUCT.md on why capture stays fast.
      capturedAt: null,
      cyclePhase: null,
      evidenceType: null,
      purpose: null,
      source: null,
      subjectScope: null,
      selfDesigned: null,
      standards: [],
    };

    await this.bucket.put(this.key(doc.id), file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { owner: this.who.email, name: file.name },
    });

    try {
      await this.db
        .prepare(
          `INSERT INTO documents (id, owner, name, folder_id, mime, size, caption, added_at, sort_order, r2_key)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7, ?8, ?9)`,
        )
        .bind(
          doc.id, this.who.email, doc.name, doc.folderId, doc.mime,
          doc.size, doc.addedAt, doc.order, this.key(doc.id),
        )
        .run();
    } catch (error) {
      // Do not leave an object in the bucket that nothing references.
      await this.bucket.delete(this.key(doc.id));
      throw error;
    }

    return doc;
  }

  async updateDocument(id: string, patch: DocumentPatch): Promise<void> {
    if (!(await this.ownsDocument(id))) throw new HttpError(404, 'Document not found');

    if (patch.folderId !== undefined && patch.folderId && !(await this.ownsFolder(patch.folderId))) {
      throw new HttpError(404, 'Folder not found');
    }

    // Map the patch to columns, skipping anything the caller did not send, so
    // a partial update never blanks a field it was not asked to touch.
    const columns: Array<[string, unknown]> = [];
    const put = (column: string, value: unknown) => columns.push([column, value]);

    if (patch.caption !== undefined) put('caption', patch.caption);
    if (patch.folderId !== undefined) put('folder_id', patch.folderId);
    if (patch.capturedAt !== undefined) put('captured_at', patch.capturedAt);
    if (patch.cyclePhase !== undefined) put('cycle_phase', emptyToNull(patch.cyclePhase));
    if (patch.evidenceType !== undefined) put('evidence_type', emptyToNull(patch.evidenceType));
    if (patch.purpose !== undefined) put('purpose', emptyToNull(patch.purpose));
    if (patch.source !== undefined) put('source', emptyToNull(patch.source));
    if (patch.subjectScope !== undefined) put('subject_scope', emptyToNull(patch.subjectScope));
    if (patch.selfDesigned !== undefined) {
      put('self_designed', patch.selfDesigned === null ? null : patch.selfDesigned ? 1 : 0);
    }
    if (patch.standards !== undefined) {
      put('standards', patch.standards.length > 0 ? JSON.stringify(patch.standards) : null);
    }

    if (columns.length === 0) return;

    // Parameters start at ?3 because ?1/?2 are the id and owner.
    const assignments = columns.map(([column], i) => `${column} = ?${i + 3}`).join(', ');
    await this.db
      .prepare(`UPDATE documents SET ${assignments} WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.email, ...columns.map(([, value]) => value))
      .run();
  }

  /**
   * Rewrites sort_order for a set of documents in one batch.
   *
   * Export order is submission order, so this is not cosmetic — it is how a
   * user controls the shape of the document they hand to an assessor.
   * Unknown or unowned ids are ignored rather than failing the whole reorder.
   */
  async reorderDocuments(ids: string[]): Promise<number> {
    const owned = new Set((await this.documents()).map((doc) => doc.id));
    const valid = ids.filter((id) => owned.has(id));
    if (valid.length === 0) return 0;

    await this.db.batch(
      valid.map((id, index) =>
        this.db
          .prepare(`UPDATE documents SET sort_order = ?3 WHERE id = ?1 AND owner = ?2`)
          .bind(id, this.who.email, index),
      ),
    );
    return valid.length;
  }

  /** Same, for folders — folders are the PDF's section order. */
  async reorderFolders(ids: string[]): Promise<number> {
    const owned = new Set((await this.folders()).map((folder) => folder.id));
    const valid = ids.filter((id) => owned.has(id));
    if (valid.length === 0) return 0;

    await this.db.batch(
      valid.map((id, index) =>
        this.db
          .prepare(`UPDATE folders SET sort_order = ?3 WHERE id = ?1 AND owner = ?2`)
          .bind(id, this.who.email, index),
      ),
    );
    return valid.length;
  }

  /* ------------------------------------------------------------ programmes */

  async programmes(): Promise<ProgrammeRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, template, name, starts_on, ends_on, created_at, archived
           FROM programmes WHERE owner = ?1
          ORDER BY archived, created_at DESC`,
      )
      .bind(this.who.email)
      .all<Record<string, unknown>>();

    return results.map((row) => ({
      id: row.id as string,
      template: row.template as string,
      name: row.name as string,
      startsOn: (row.starts_on as string | null) ?? null,
      endsOn: (row.ends_on as string | null) ?? null,
      createdAt: row.created_at as number,
      archived: Boolean(row.archived),
    }));
  }

  async createProgramme(input: {
    template: string;
    name: string;
    startsOn: string | null;
    endsOn: string | null;
  }): Promise<ProgrammeRow> {
    const programme: ProgrammeRow = {
      id: crypto.randomUUID(),
      template: input.template,
      name: input.name,
      startsOn: isoDateOrNull(input.startsOn),
      endsOn: isoDateOrNull(input.endsOn),
      createdAt: Date.now(),
      archived: false,
    };

    await this.db
      .prepare(
        `INSERT INTO programmes (id, owner, template, name, starts_on, ends_on, created_at, archived)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)`,
      )
      .bind(
        programme.id, this.who.email, programme.template, programme.name,
        programme.startsOn, programme.endsOn, programme.createdAt,
      )
      .run();

    return programme;
  }

  async updateProgramme(
    id: string,
    patch: { name?: string; startsOn?: string | null; endsOn?: string | null; archived?: boolean },
  ): Promise<void> {
    const owned = await this.db
      .prepare(`SELECT 1 AS ok FROM programmes WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.email)
      .first<{ ok: number }>();
    if (!owned) throw new HttpError(404, 'Programme not found');

    const columns: Array<[string, unknown]> = [];
    if (patch.name !== undefined) columns.push(['name', patch.name]);
    if (patch.startsOn !== undefined) columns.push(['starts_on', isoDateOrNull(patch.startsOn)]);
    if (patch.endsOn !== undefined) columns.push(['ends_on', isoDateOrNull(patch.endsOn)]);
    if (patch.archived !== undefined) columns.push(['archived', patch.archived ? 1 : 0]);
    if (columns.length === 0) return;

    const assignments = columns.map(([column], i) => `${column} = ?${i + 3}`).join(', ');
    await this.db
      .prepare(`UPDATE programmes SET ${assignments} WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.email, ...columns.map(([, value]) => value))
      .run();
  }

  /** Removes the programme only. Evidence is never touched — it is a lens. */
  async deleteProgramme(id: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM programmes WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.email)
      .run();
  }

  async deleteDocument(id: string): Promise<void> {
    if (!(await this.ownsDocument(id))) throw new HttpError(404, 'Document not found');
    await this.bucket.delete(this.key(id));
    await this.db
      .prepare(`DELETE FROM documents WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.email)
      .run();
  }

  /** Streams a document's bytes back, for the PDF export and previews. */
  async documentBody(id: string): Promise<{ body: ReadableStream; mime: string; name: string } | null> {
    const row = await this.db
      .prepare(`SELECT name, mime FROM documents WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.email)
      .first<{ name: string; mime: string }>();
    if (!row) return null;

    const object = await this.bucket.get(this.key(id));
    if (!object) return null;
    return { body: object.body, mime: row.mime || 'application/octet-stream', name: row.name };
  }

  async clearAll(): Promise<void> {
    const docs = await this.documents();
    if (docs.length > 0) await this.bucket.delete(docs.map((doc) => this.key(doc.id)));
    await this.db.batch([
      this.db.prepare(`DELETE FROM documents WHERE owner = ?1`).bind(this.who.email),
      this.db.prepare(`DELETE FROM folders WHERE owner = ?1`).bind(this.who.email),
      // Clears the cover details but keeps the acknowledgement on record.
      this.db
        .prepare(`UPDATE profiles SET name = '', title = '', summary = '' WHERE owner = ?1`)
        .bind(this.who.email),
    ]);
  }

  private async ownsFolder(id: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT 1 AS ok FROM folders WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.email)
      .first<{ ok: number }>();
    return Boolean(row);
  }

  private async ownsDocument(id: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT 1 AS ok FROM documents WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.email)
      .first<{ ok: number }>();
    return Boolean(row);
  }
}
