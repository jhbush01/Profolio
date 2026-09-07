/**
 * D1 + R2 data access, scoped to one owner.
 *
 * Every query filters on `owner`, so a bug in a route handler cannot leak one
 * user's documents to another even once this becomes multi-user.
 */
import type { Identity } from './access';

export interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
  note: string;
  createdAt: number;
  order: number;
}

export interface DocumentRow {
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
        `SELECT id, name, folder_id, mime, size, caption, added_at, sort_order
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

  async saveProfile(profile: ProfileRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO profiles (owner, name, title, summary) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(owner) DO UPDATE SET name = ?2, title = ?3, summary = ?4`,
      )
      .bind(this.who.email, profile.name, profile.title, profile.summary)
      .run();
  }

  async createFolder(name: string, parentId: string | null): Promise<FolderRow> {
    if (parentId && !(await this.ownsFolder(parentId))) {
      throw new Error('Parent folder not found');
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
    if (!(await this.ownsFolder(id))) throw new Error('Folder not found');
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
    if (!(await this.ownsFolder(id))) throw new Error('Folder not found');

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
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`"${file.name}" is larger than the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
    }
    if (folderId && !(await this.ownsFolder(folderId))) throw new Error('Folder not found');

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

  async updateDocument(
    id: string,
    patch: { caption?: string; folderId?: string | null },
  ): Promise<void> {
    if (!(await this.ownsDocument(id))) throw new Error('Document not found');
    if (patch.caption !== undefined) {
      await this.db
        .prepare(`UPDATE documents SET caption = ?3 WHERE id = ?1 AND owner = ?2`)
        .bind(id, this.who.email, patch.caption)
        .run();
    }
    if (patch.folderId !== undefined) {
      if (patch.folderId && !(await this.ownsFolder(patch.folderId))) {
        throw new Error('Folder not found');
      }
      await this.db
        .prepare(`UPDATE documents SET folder_id = ?3 WHERE id = ?1 AND owner = ?2`)
        .bind(id, this.who.email, patch.folderId)
        .run();
    }
  }

  async deleteDocument(id: string): Promise<void> {
    if (!(await this.ownsDocument(id))) throw new Error('Document not found');
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
      this.db.prepare(`DELETE FROM profiles WHERE owner = ?1`).bind(this.who.email),
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
