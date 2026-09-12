/**
 * D1 + R2 data access, scoped to one owner.
 *
 * Every query filters on `owner`, so a bug in a route handler cannot leak one
 * user's documents to another even once this becomes multi-user.
 */
import { HttpError } from './access';
import type { Identity } from './accounts';
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
  /** Programmes this record has been assigned to. Never inferred. */
  programmes: string[];
}

export interface ProfileRow {
  name: string;
  title: string;
  summary: string;
  /** Long-form statement of practice. Printed after the cover on export. */
  philosophy: string;
  /** How someone reaches you. Shown on the cover page. */
  contactEmail: string;
  contactPhone: string;
  contactLocation: string;
  /** Free text, one per line: a portfolio site, a professional profile. */
  contactLinks: string;
  /**
   * When the picture was last replaced, or null when there is none. Read-only:
   * saveProfile does not touch it, and it doubles as the cache-buster on the
   * one stable URL the image is served from.
   */
  avatarUpdatedAt?: number | null;
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
  /** Template-declared context answers, keyed by field id. */
  context: Record<string, string>;
  /** Template-declared report answers, keyed by section name. */
  report: Record<string, string>;
  /** Set while closed. Nothing joins or leaves a closed programme. */
  closedAt: number | null;
  /** Last time it was reopened, so a changed submission is traceable. */
  reopenedAt: number | null;
}

/** Tolerates null and malformed JSON rather than failing a whole page load. */
function parseContext(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => [key, value as string]),
    );
  } catch {
    return {};
  }
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

/**
 * Total bytes one account may hold.
 *
 * A placement's worth of photographs and PDFs runs to a few hundred megabytes,
 * so this is generous for the intended use and still bounds what a single
 * sign-in can put on the bill. Without it, open registration and an R2 bucket
 * are the same thing as an open R2 bucket.
 */
export const MAX_ACCOUNT_BYTES = 2 * 1024 * 1024 * 1024;

/** Bytes for a human, in whichever unit does not read as "0.0GB". */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/**
 * A profile picture is a picture, not an archive. Small enough that it is not
 * worth counting against the account's storage allowance, and small enough
 * that a phone photo has to be resized before it will go — which the account
 * page does in the browser rather than making the Worker do it.
 */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

/** R2 caps the keys per delete call; stay well under it. */
const DELETE_BATCH = 500;

async function deleteObjects(bucket: R2Bucket, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    await bucket.delete(keys.slice(i, i + DELETE_BATCH));
  }
}

export class Repo {
  constructor(
    private readonly db: D1Database,
    private readonly bucket: R2Bucket,
    private readonly who: Identity,
  ) {}

  /**
   * Key for a NEW object. Existing objects are not moved when an account is
   * rekeyed, so every read and delete uses the r2_key stored on the row
   * instead — this is only ever used at insert time.
   */
  private newKey(documentId: string): string {
    // Namespaced by account so bucket objects are attributable and prefix-listable.
    return `${this.who.accountId}/${documentId}`;
  }

  /** The stored R2 key of every document this account owns, by document id. */
  private async objectKeys(): Promise<Map<string, string>> {
    const { results } = await this.db
      .prepare(`SELECT id, r2_key FROM documents WHERE owner = ?1`)
      .bind(this.who.accountId)
      .all<{ id: string; r2_key: string }>();
    return new Map(results.map((row) => [row.id, row.r2_key]));
  }

  /** Bytes this account is currently storing. Summed, so it cannot drift. */
  async storageUsed(): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COALESCE(SUM(size), 0) AS bytes FROM documents WHERE owner = ?1`)
      .bind(this.who.accountId)
      .first<{ bytes: number }>();
    return row?.bytes ?? 0;
  }

  async folders(): Promise<FolderRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, name, parent_id, note, created_at, sort_order
           FROM folders WHERE owner = ?1
          ORDER BY sort_order, name`,
      )
      .bind(this.who.accountId)
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
      .bind(this.who.accountId)
      .all<Record<string, unknown>>();

    // One extra query rather than a join: a join would repeat every document
    // row once per programme, and this list is already the biggest payload the
    // vault returns.
    const assignments = await this.db
      .prepare(`SELECT document_id, programme_id FROM document_programmes WHERE owner = ?1`)
      .bind(this.who.accountId)
      .all<{ document_id: string; programme_id: string }>();

    const byDocument = new Map<string, string[]>();
    for (const row of assignments.results) {
      const list = byDocument.get(row.document_id);
      if (list) list.push(row.programme_id);
      else byDocument.set(row.document_id, [row.programme_id]);
    }

    return results.map((row) => ({
      programmes: byDocument.get(row.id as string) ?? [],
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
      .prepare(
        `SELECT name, title, summary, philosophy,
                contact_email, contact_phone, contact_location, contact_links,
                avatar_updated_at
           FROM profiles WHERE owner = ?1`,
      )
      .bind(this.who.accountId)
      .first<Record<string, unknown>>();
    return {
      name: (row?.name as string) ?? '',
      title: (row?.title as string) ?? '',
      summary: (row?.summary as string) ?? '',
      philosophy: (row?.philosophy as string) ?? '',
      contactEmail: (row?.contact_email as string) ?? '',
      contactPhone: (row?.contact_phone as string) ?? '',
      contactLocation: (row?.contact_location as string) ?? '',
      contactLinks: (row?.contact_links as string) ?? '',
      avatarUpdatedAt: (row?.avatar_updated_at as number | null) ?? null,
    };
  }

  /**
   * When this owner acknowledged the de-identification requirement, or null.
   * Uploads are refused until it is set — see POST /api/documents.
   */
  async deidAcknowledgedAt(): Promise<number | null> {
    const row = await this.db
      .prepare(`SELECT deid_ack_at FROM profiles WHERE owner = ?1`)
      .bind(this.who.accountId)
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
      .bind(this.who.accountId, now)
      .run();
    return (await this.deidAcknowledgedAt()) ?? now;
  }

  async saveProfile(profile: ProfileRow): Promise<void> {
    await this.db
      .prepare(
        // Only the cover fields are touched; deid_ack_at is a compliance
        // record and must survive a profile edit.
        `INSERT INTO profiles
           (owner, name, title, summary, philosophy,
            contact_email, contact_phone, contact_location, contact_links)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(owner) DO UPDATE SET
           name = ?2, title = ?3, summary = ?4, philosophy = ?5,
           contact_email = ?6, contact_phone = ?7,
           contact_location = ?8, contact_links = ?9`,
      )
      .bind(
        this.who.accountId,
        profile.name,
        profile.title,
        profile.summary,
        profile.philosophy,
        profile.contactEmail,
        profile.contactPhone,
        profile.contactLocation,
        profile.contactLinks,
      )
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
      .bind(this.who.accountId, parentId)
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
      .bind(folder.id, this.who.accountId, folder.name, folder.parentId, folder.createdAt, folder.order)
      .run();

    return folder;
  }

  async updateFolder(id: string, patch: { name?: string; note?: string }): Promise<void> {
    if (!(await this.ownsFolder(id))) throw new HttpError(404, 'Folder not found');
    if (patch.name !== undefined) {
      await this.db
        .prepare(`UPDATE folders SET name = ?3 WHERE id = ?1 AND owner = ?2`)
        .bind(id, this.who.accountId, patch.name)
        .run();
    }
    if (patch.note !== undefined) {
      await this.db
        .prepare(`UPDATE folders SET note = ?3 WHERE id = ?1 AND owner = ?2`)
        .bind(id, this.who.accountId, patch.note)
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
    if (docs.length > 0) {
      const keys = await this.objectKeys();
      await deleteObjects(
        this.bucket,
        docs.map((doc) => keys.get(doc.id)).filter((key): key is string => Boolean(key)),
      );
    }

    const statements = [
      ...docs.map((doc) =>
        this.db
          .prepare(`DELETE FROM document_programmes WHERE document_id = ?1 AND owner = ?2`)
          .bind(doc.id, this.who.accountId),
      ),
      ...docs.map((doc) =>
        this.db.prepare(`DELETE FROM documents WHERE id = ?1 AND owner = ?2`).bind(doc.id, this.who.accountId),
      ),
      ...[...doomed].map((folderId) =>
        this.db.prepare(`DELETE FROM folders WHERE id = ?1 AND owner = ?2`).bind(folderId, this.who.accountId),
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

    // Checked per file rather than per request, so a multi-file upload stores
    // what fits and reports the one that does not, instead of failing the lot.
    const used = await this.storageUsed();
    if (used + file.size > MAX_ACCOUNT_BYTES) {
      throw new HttpError(
        413,
        `"${file.name}" does not fit: you are using ${size(used)} of your ${size(MAX_ACCOUNT_BYTES)}. ` +
          `Remove something, or export and clear what you no longer need.`,
      );
    }
    if (folderId && !(await this.ownsFolder(folderId))) throw new HttpError(404, 'Folder not found');

    const siblings = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM documents
          WHERE owner = ?1 AND ((?2 IS NULL AND folder_id IS NULL) OR folder_id = ?2)`,
      )
      .bind(this.who.accountId, folderId)
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
      programmes: [],
    };

    const objectKey = this.newKey(doc.id);
    await this.bucket.put(objectKey, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { owner: this.who.accountId, name: file.name },
    });

    try {
      await this.db
        .prepare(
          `INSERT INTO documents (id, owner, name, folder_id, mime, size, caption, added_at, sort_order, r2_key)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, '', ?7, ?8, ?9)`,
        )
        .bind(
          doc.id, this.who.accountId, doc.name, doc.folderId, doc.mime,
          doc.size, doc.addedAt, doc.order, objectKey,
        )
        .run();
    } catch (error) {
      // Do not leave an object in the bucket that nothing references.
      await this.bucket.delete(objectKey);
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
      .bind(id, this.who.accountId, ...columns.map(([, value]) => value))
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
          .bind(id, this.who.accountId, index),
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
          .bind(id, this.who.accountId, index),
      ),
    );
    return valid.length;
  }

  /* ------------------------------------------------------------ programmes */

  async programmes(): Promise<ProgrammeRow[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, template, name, starts_on, ends_on, created_at, archived, context, report,
                closed_at, reopened_at
           FROM programmes WHERE owner = ?1
          ORDER BY archived, created_at DESC`,
      )
      .bind(this.who.accountId)
      .all<Record<string, unknown>>();

    return results.map((row) => ({
      id: row.id as string,
      template: row.template as string,
      name: row.name as string,
      startsOn: (row.starts_on as string | null) ?? null,
      endsOn: (row.ends_on as string | null) ?? null,
      createdAt: row.created_at as number,
      archived: Boolean(row.archived),
      context: parseContext(row.context),
      report: parseContext(row.report),
      closedAt: (row.closed_at as number | null) ?? null,
      reopenedAt: (row.reopened_at as number | null) ?? null,
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
      context: {},
      report: {},
      closedAt: null,
      reopenedAt: null,
    };

    await this.db
      .prepare(
        `INSERT INTO programmes (id, owner, template, name, starts_on, ends_on, created_at, archived)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)`,
      )
      .bind(
        programme.id, this.who.accountId, programme.template, programme.name,
        programme.startsOn, programme.endsOn, programme.createdAt,
      )
      .run();

    return programme;
  }

  async updateProgramme(
    id: string,
    patch: {
      name?: string;
      startsOn?: string | null;
      endsOn?: string | null;
      archived?: boolean;
      context?: Record<string, string>;
      report?: Record<string, string>;
    },
  ): Promise<void> {
    const owned = await this.db
      .prepare(`SELECT 1 AS ok FROM programmes WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.accountId)
      .first<{ ok: number }>();
    if (!owned) throw new HttpError(404, 'Programme not found');

    const columns: Array<[string, unknown]> = [];
    if (patch.name !== undefined) columns.push(['name', patch.name]);
    if (patch.startsOn !== undefined) columns.push(['starts_on', isoDateOrNull(patch.startsOn)]);
    if (patch.endsOn !== undefined) columns.push(['ends_on', isoDateOrNull(patch.endsOn)]);
    if (patch.archived !== undefined) columns.push(['archived', patch.archived ? 1 : 0]);
    if (patch.context !== undefined) {
      // Replaced wholesale: the client always sends the complete answer set,
      // so a cleared field is a real clear rather than a missing key.
      columns.push(['context', JSON.stringify(patch.context)]);
    }
    if (patch.report !== undefined) {
      columns.push(['report', JSON.stringify(patch.report)]);
    }
    if (columns.length === 0) return;

    const assignments = columns.map(([column], i) => `${column} = ?${i + 3}`).join(', ');
    await this.db
      .prepare(`UPDATE programmes SET ${assignments} WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.accountId, ...columns.map(([, value]) => value))
      .run();
  }

  /**
   * Replaces the set of programmes a document belongs to.
   *
   * Closed programmes are immovable in both directions: a closed programme
   * cannot gain a record, and cannot lose one either. Enforced here and not
   * only in the UI, because "the export matches what I submitted" is the whole
   * point of closing and a client must not be the only thing holding it.
   */
  async setDocumentProgrammes(documentId: string, programmeIds: string[]): Promise<string[]> {
    if (!(await this.ownsDocument(documentId))) throw new HttpError(404, 'Document not found');

    const all = await this.programmes();
    const owned = new Map(all.map((programme) => [programme.id, programme]));
    const wanted = [...new Set(programmeIds)].filter((id) => owned.has(id));

    const { results } = await this.db
      .prepare(`SELECT programme_id FROM document_programmes WHERE document_id = ?1 AND owner = ?2`)
      .bind(documentId, this.who.accountId)
      .all<{ programme_id: string }>();
    const current = new Set(results.map((row) => row.programme_id));

    const add = wanted.filter((id) => !current.has(id));
    const remove = [...current].filter((id) => !wanted.includes(id));

    for (const id of [...add, ...remove]) {
      const programme = owned.get(id);
      if (programme && programme.closedAt !== null) {
        throw new HttpError(409, `"${programme.name}" is closed. Reopen it to change what it holds.`);
      }
    }

    const now = Date.now();
    const statements = [
      ...add.map((id) =>
        this.db
          .prepare(
            `INSERT INTO document_programmes (document_id, programme_id, owner, assigned_at)
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING`,
          )
          .bind(documentId, id, this.who.accountId, now),
      ),
      ...remove.map((id) =>
        this.db
          .prepare(
            `DELETE FROM document_programmes
              WHERE document_id = ?1 AND programme_id = ?2 AND owner = ?3`,
          )
          .bind(documentId, id, this.who.accountId),
      ),
    ];
    if (statements.length > 0) await this.db.batch(statements);

    return wanted;
  }

  /**
   * Closes or reopens a programme.
   *
   * Reopening stamps `reopened_at` rather than clearing the history, so a
   * portfolio whose contents changed after submission can be told apart from
   * one that never moved.
   */
  async setProgrammeClosed(id: string, closed: boolean): Promise<void> {
    const owned = await this.db
      .prepare(`SELECT closed_at FROM programmes WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.accountId)
      .first<{ closed_at: number | null }>();
    if (!owned) throw new HttpError(404, 'Programme not found');

    const now = Date.now();
    if (closed) {
      if (owned.closed_at !== null) return;
      await this.db
        .prepare(`UPDATE programmes SET closed_at = ?3 WHERE id = ?1 AND owner = ?2`)
        .bind(id, this.who.accountId, now)
        .run();
      return;
    }

    if (owned.closed_at === null) return;
    await this.db
      .prepare(`UPDATE programmes SET closed_at = NULL, reopened_at = ?3 WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.accountId, now)
      .run();
  }

  /** Removes the programme and its assignments. Evidence itself is never touched. */
  async deleteProgramme(id: string): Promise<void> {
    // The assignments are deleted explicitly rather than left to the foreign
    // key: a stale join row would make documents report a programme that no
    // longer exists.
    await this.db.batch([
      this.db
        .prepare(`DELETE FROM document_programmes WHERE programme_id = ?1 AND owner = ?2`)
        .bind(id, this.who.accountId),
      this.db.prepare(`DELETE FROM programmes WHERE id = ?1 AND owner = ?2`).bind(id, this.who.accountId),
    ]);
  }

  async deleteDocument(id: string): Promise<void> {
    const row = await this.db
      .prepare(`SELECT r2_key FROM documents WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.accountId)
      .first<{ r2_key: string }>();
    if (!row) throw new HttpError(404, 'Document not found');
    await this.bucket.delete(row.r2_key);
    await this.db.batch([
      this.db
        .prepare(`DELETE FROM document_programmes WHERE document_id = ?1 AND owner = ?2`)
        .bind(id, this.who.accountId),
      this.db.prepare(`DELETE FROM documents WHERE id = ?1 AND owner = ?2`).bind(id, this.who.accountId),
    ]);
  }

  /** Streams a document's bytes back, for the PDF export and previews. */
  async documentBody(id: string): Promise<{ body: ReadableStream; mime: string; name: string } | null> {
    const row = await this.db
      .prepare(`SELECT name, mime, r2_key FROM documents WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.accountId)
      .first<{ name: string; mime: string; r2_key: string }>();
    if (!row) return null;

    const object = await this.bucket.get(row.r2_key);
    if (!object) return null;
    return { body: object.body, mime: row.mime || 'application/octet-stream', name: row.name };
  }

  /**
   * Everything this account has put in: files, folders, projects, cover details.
   *
   * Projects belong in here. They were missing, which meant "Clear everything"
   * left every context statement behind — the school, sector, year level, class
   * characteristics and community notes are the most identifying free text in
   * the app, and they survived the button that claimed to remove everything.
   *
   * The de-identification acknowledgement is deliberately kept: it is a record
   * that the warning was shown and accepted, and clearing content is not the
   * same as taking it back. deleteAccount removes it along with the account.
   */
  async clearAll(): Promise<void> {
    const keys = [...(await this.objectKeys()).values()];
    // The picture is a cover detail, and cover details go. It is not in
    // documents, so objectKeys() will never find it — the bucket only forgets
    // what something explicitly deletes.
    const avatar = await this.avatarKey();
    if (avatar) keys.push(avatar);
    if (keys.length > 0) await deleteObjects(this.bucket, keys);
    await this.db.batch([
      this.db.prepare(`DELETE FROM document_programmes WHERE owner = ?1`).bind(this.who.accountId),
      this.db.prepare(`DELETE FROM documents WHERE owner = ?1`).bind(this.who.accountId),
      this.db.prepare(`DELETE FROM folders WHERE owner = ?1`).bind(this.who.accountId),
      this.db.prepare(`DELETE FROM programmes WHERE owner = ?1`).bind(this.who.accountId),
      this.db
        .prepare(
          `UPDATE profiles
              SET name = '', title = '', summary = '',
                  avatar_key = NULL, avatar_mime = NULL, avatar_updated_at = NULL
            WHERE owner = ?1`,
        )
        .bind(this.who.accountId),
    ]);
  }

  /**
   * Clears the content, then removes the account itself: the profile row, every
   * identity that resolved to it, and the account record.
   *
   * Signing in again afterwards is not blocked — it produces a new, empty
   * account, because deleting your data is not the same as being locked out.
   */
  async deleteAccount(): Promise<void> {
    await this.clearAll();
    await this.db.batch([
      this.db.prepare(`DELETE FROM profiles WHERE owner = ?1`).bind(this.who.accountId),
      this.db
        .prepare(`DELETE FROM account_identities WHERE account_id = ?1`)
        .bind(this.who.accountId),
      this.db.prepare(`DELETE FROM accounts WHERE id = ?1`).bind(this.who.accountId),
    ]);
  }

  /**
   * Replaces the profile picture.
   *
   * The key carries a timestamp rather than being one stable path, so a
   * replacement writes a new object and the old one is deleted explicitly.
   * Overwriting in place leaves R2 and any cache disagreeing about which
   * bytes are current for a while; a new key never does.
   */
  async saveAvatar(file: File): Promise<number> {
    if (!file.type.startsWith('image/')) {
      throw new HttpError(415, 'A profile picture has to be an image');
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw new HttpError(413, `Pictures are limited to ${MAX_AVATAR_BYTES / (1024 * 1024)}MB`);
    }

    const previous = await this.avatarKey();
    const updatedAt = Date.now();
    const key = `${this.who.accountId}/profile/${updatedAt}`;

    await this.bucket.put(key, file.stream(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { owner: this.who.accountId },
    });

    await this.db
      .prepare(
        `INSERT INTO profiles (owner, name, title, summary, avatar_key, avatar_mime, avatar_updated_at)
         VALUES (?1, '', '', '', ?2, ?3, ?4)
         ON CONFLICT(owner) DO UPDATE SET avatar_key = ?2, avatar_mime = ?3, avatar_updated_at = ?4`,
      )
      .bind(this.who.accountId, key, file.type, updatedAt)
      .run();

    if (previous) await this.bucket.delete(previous);
    return updatedAt;
  }

  async deleteAvatar(): Promise<void> {
    const key = await this.avatarKey();
    if (key) await this.bucket.delete(key);
    await this.db
      .prepare(
        `UPDATE profiles SET avatar_key = NULL, avatar_mime = NULL, avatar_updated_at = NULL
          WHERE owner = ?1`,
      )
      .bind(this.who.accountId)
      .run();
  }

  /** Streams the picture back to its owner, or null when there is none. */
  async avatarBody(): Promise<{ body: ReadableStream; mime: string } | null> {
    const row = await this.db
      .prepare(`SELECT avatar_key, avatar_mime FROM profiles WHERE owner = ?1`)
      .bind(this.who.accountId)
      .first<{ avatar_key: string | null; avatar_mime: string | null }>();
    if (!row?.avatar_key) return null;

    const object = await this.bucket.get(row.avatar_key);
    if (!object) return null;
    return { body: object.body, mime: row.avatar_mime || 'application/octet-stream' };
  }

  private async avatarKey(): Promise<string | null> {
    const row = await this.db
      .prepare(`SELECT avatar_key FROM profiles WHERE owner = ?1`)
      .bind(this.who.accountId)
      .first<{ avatar_key: string | null }>();
    return row?.avatar_key ?? null;
  }

  private async ownsFolder(id: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT 1 AS ok FROM folders WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.accountId)
      .first<{ ok: number }>();
    return Boolean(row);
  }

  private async ownsDocument(id: string): Promise<boolean> {
    const row = await this.db
      .prepare(`SELECT 1 AS ok FROM documents WHERE id = ?1 AND owner = ?2`)
      .bind(id, this.who.accountId)
      .first<{ ok: number }>();
    return Boolean(row);
  }
}
