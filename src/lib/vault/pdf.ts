/**
 * Client-side PDF export.
 *
 * Builds a single, ordered PDF from everything in the vault: a cover page, a
 * contents page with real page numbers, a divider for each folder, and then the
 * documents themselves — images placed on their own page, uploaded PDFs copied
 * in page-for-page, and anything pdf-lib cannot render represented by a card
 * that records what the file was.
 *
 * Runs entirely in the browser; no bytes leave the device.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { VaultDocument, VaultFolder, VaultProfile } from './types';
import { renderKindFor } from './types';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.08, 0.09, 0.12);
const MUTED = rgb(0.36, 0.4, 0.45);
const ACCENT = rgb(0.12, 0.36, 0.55);
const LINE = rgb(0.89, 0.9, 0.92);

/** Entries per contents page, used to predict how many pages the TOC needs. */
const TOC_ROWS_PER_PAGE = 28;

/**
 * pdf-lib's standard fonts are WinAnsi-encoded and throw on anything outside
 * it. Map the common typographic characters back to ASCII and drop the rest,
 * so a stray emoji in a filename cannot fail the whole export.
 */
function sanitize(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');
}

/** Greedy word wrap against real glyph widths. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of sanitize(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface TocEntry {
  label: string;
  depth: number;
  /** Page index before the contents pages are spliced in. */
  rawIndex: number;
}

export interface ExportProgress {
  (done: number, total: number, label: string): void;
}

export async function buildPortfolioPdf(
  profile: VaultProfile,
  folders: VaultFolder[],
  documents: VaultDocument[],
  onProgress: ExportProgress = () => {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const width = A4[0];
  const contentWidth = width - MARGIN * 2;

  /* ------------------------------------------------------------- cover */
  const cover = pdf.addPage(A4);
  {
    let y = A4[1] - 200;
    cover.drawRectangle({ x: MARGIN, y: y + 78, width: 54, height: 4, color: ACCENT });

    const name = sanitize(profile.name || 'Portfolio');
    for (const line of wrap(name, bold, 32, contentWidth)) {
      cover.drawText(line, { x: MARGIN, y, size: 32, font: bold, color: INK });
      y -= 38;
    }
    if (profile.title) {
      y -= 6;
      for (const line of wrap(profile.title, regular, 14, contentWidth)) {
        cover.drawText(line, { x: MARGIN, y, size: 14, font: regular, color: MUTED });
        y -= 20;
      }
    }
    if (profile.summary) {
      y -= 18;
      for (const line of wrap(profile.summary, regular, 11, contentWidth)) {
        cover.drawText(line, { x: MARGIN, y, size: 11, font: regular, color: MUTED });
        y -= 16;
      }
    }

    const generated = new Date().toLocaleDateString(undefined, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const counts = `${documents.length} document${documents.length === 1 ? '' : 's'} in ${
      folders.length
    } folder${folders.length === 1 ? '' : 's'}`;
    cover.drawLine({
      start: { x: MARGIN, y: 128 },
      end: { x: width - MARGIN, y: 128 },
      thickness: 1,
      color: LINE,
    });
    cover.drawText(sanitize(counts), { x: MARGIN, y: 108, size: 10, font: regular, color: MUTED });
    cover.drawText(sanitize(`Exported ${generated}`), {
      x: MARGIN,
      y: 92,
      size: 10,
      font: regular,
      color: MUTED,
    });
  }

  /* ------------------------------------------- ordered folder traversal */
  const childrenOf = (parentId: string | null) =>
    folders.filter((folder) => folder.parentId === parentId);

  const ordered: Array<{ folder: VaultFolder; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of childrenOf(parentId)) {
      ordered.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);

  const unfiled = documents.filter((doc) => !doc.folderId);
  const toc: TocEntry[] = [];
  const totalSteps = documents.length || 1;
  let step = 0;

  /** Page index relative to the finished document, before TOC insertion. */
  const rawIndex = () => pdf.getPageCount();

  async function drawDocument(doc: VaultDocument, depth: number) {
    onProgress(step, totalSteps, doc.name);
    const kind = renderKindFor(doc.mime, doc.name);
    const startIndex = rawIndex();

    try {
      if (kind === 'pdf') {
        const bytes = new Uint8Array(await doc.blob.arrayBuffer());
        const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const copied = await pdf.copyPages(source, source.getPageIndices());
        for (const page of copied) pdf.addPage(page);
        if (copied.length === 0) throw new Error('PDF contained no pages');
      } else if (kind === 'image') {
        const bytes = new Uint8Array(await doc.blob.arrayBuffer());
        const isPng = doc.mime.includes('png') || doc.name.toLowerCase().endsWith('.png');
        const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);

        const page = pdf.addPage(A4);
        const captionSpace = doc.caption ? 54 : 30;
        const maxW = contentWidth;
        const maxH = A4[1] - MARGIN * 2 - 40 - captionSpace;
        const scale = Math.min(maxW / image.width, maxH / image.height, 1);
        const drawW = image.width * scale;
        const drawH = image.height * scale;

        page.drawText(sanitize(doc.name), {
          x: MARGIN,
          y: A4[1] - MARGIN,
          size: 11,
          font: bold,
          color: INK,
        });
        page.drawImage(image, {
          x: MARGIN + (maxW - drawW) / 2,
          y: A4[1] - MARGIN - 30 - drawH,
          width: drawW,
          height: drawH,
        });
        if (doc.caption) {
          let y = A4[1] - MARGIN - 46 - drawH;
          for (const line of wrap(doc.caption, regular, 9.5, contentWidth)) {
            page.drawText(line, { x: MARGIN, y, size: 9.5, font: regular, color: MUTED });
            y -= 13;
          }
        }
      } else {
        drawCard(doc, 'This file type cannot be rendered inline. It is listed here for the record.');
      }
    } catch (error) {
      // One bad file must not take the whole export down.
      const reason = error instanceof Error ? error.message : String(error);
      while (pdf.getPageCount() > startIndex) pdf.removePage(pdf.getPageCount() - 1);
      drawCard(doc, `This file could not be embedded (${reason}).`);
    }

    toc.push({ label: doc.name, depth: depth + 1, rawIndex: startIndex });
    step += 1;
  }

  function drawCard(doc: VaultDocument, message: string) {
    const page = pdf.addPage(A4);
    let y = A4[1] - MARGIN - 20;
    page.drawRectangle({ x: MARGIN, y: y - 4, width: 40, height: 3, color: ACCENT });
    y -= 34;
    for (const line of wrap(doc.name, bold, 18, contentWidth)) {
      page.drawText(line, { x: MARGIN, y, size: 18, font: bold, color: INK });
      y -= 24;
    }
    y -= 6;
    const meta = `${doc.mime || 'unknown type'} - ${formatBytes(doc.size)}`;
    page.drawText(sanitize(meta), { x: MARGIN, y, size: 10, font: regular, color: MUTED });
    y -= 26;
    if (doc.caption) {
      for (const line of wrap(doc.caption, regular, 11, contentWidth)) {
        page.drawText(line, { x: MARGIN, y, size: 11, font: regular, color: INK });
        y -= 16;
      }
      y -= 12;
    }
    for (const line of wrap(message, regular, 9.5, contentWidth)) {
      page.drawText(line, { x: MARGIN, y, size: 9.5, font: regular, color: MUTED });
      y -= 13;
    }
  }

  function drawDivider(folder: VaultFolder, depth: number, count: number) {
    const page = pdf.addPage(A4);
    let y = A4[1] / 2 + 40;
    page.drawRectangle({ x: MARGIN, y: y + 34, width: 54, height: 4, color: ACCENT });
    for (const line of wrap(folder.name, bold, 26, contentWidth)) {
      page.drawText(line, { x: MARGIN, y, size: 26, font: bold, color: INK });
      y -= 32;
    }
    y -= 4;
    page.drawText(sanitize(`${count} document${count === 1 ? '' : 's'}`), {
      x: MARGIN,
      y,
      size: 10,
      font: regular,
      color: ACCENT,
    });
    if (folder.note) {
      y -= 24;
      for (const line of wrap(folder.note, regular, 11, contentWidth)) {
        page.drawText(line, { x: MARGIN, y, size: 11, font: regular, color: MUTED });
        y -= 16;
      }
    }
  }

  for (const { folder, depth } of ordered) {
    const inside = documents.filter((doc) => doc.folderId === folder.id);
    toc.push({ label: folder.name, depth, rawIndex: rawIndex() });
    drawDivider(folder, depth, inside.length);
    for (const doc of inside) await drawDocument(doc, depth);
  }

  if (unfiled.length > 0) {
    const pseudo: VaultFolder = {
      id: '',
      name: 'Unfiled',
      parentId: null,
      note: 'Documents that have not been placed in a folder.',
      createdAt: 0,
      order: 0,
    };
    toc.push({ label: pseudo.name, depth: 0, rawIndex: rawIndex() });
    drawDivider(pseudo, 0, unfiled.length);
    for (const doc of unfiled) await drawDocument(doc, 0);
  }

  /* ----------------------------------------------------- contents pages */
  const tocPageCount = Math.max(1, Math.ceil(toc.length / TOC_ROWS_PER_PAGE));
  const tocPages: PDFPage[] = [];
  for (let i = 0; i < tocPageCount; i += 1) {
    // Inserted directly after the cover; content pages shift down by tocPageCount.
    tocPages.push(pdf.insertPage(1 + i, A4));
  }

  tocPages.forEach((page, pageNumber) => {
    let y = A4[1] - MARGIN - 10;
    if (pageNumber === 0) {
      page.drawText('Contents', { x: MARGIN, y, size: 20, font: bold, color: INK });
      y -= 14;
      page.drawLine({
        start: { x: MARGIN, y },
        end: { x: width - MARGIN, y },
        thickness: 1,
        color: LINE,
      });
      y -= 24;
    }

    const slice = toc.slice(
      pageNumber * TOC_ROWS_PER_PAGE,
      (pageNumber + 1) * TOC_ROWS_PER_PAGE,
    );
    for (const entry of slice) {
      const indent = MARGIN + entry.depth * 16;
      const font = entry.depth === 0 ? bold : regular;
      const size = entry.depth === 0 ? 10.5 : 9.5;
      const shown = 1 + tocPageCount + entry.rawIndex;

      let label = sanitize(entry.label);
      const maxLabel = contentWidth - 46 - entry.depth * 16;
      while (font.widthOfTextAtSize(label, size) > maxLabel && label.length > 4) {
        label = `${label.slice(0, -5)}...`;
      }

      page.drawText(label, { x: indent, y, size, font, color: entry.depth === 0 ? INK : MUTED });
      const pageLabel = String(shown);
      page.drawText(pageLabel, {
        x: width - MARGIN - regular.widthOfTextAtSize(pageLabel, size),
        y,
        size,
        font: regular,
        color: MUTED,
      });
      y -= entry.depth === 0 ? 20 : 15;
    }
  });

  /* -------------------------------------------- footers with page numbers */
  const pages = pdf.getPages();
  pages.forEach((page, index) => {
    if (index === 0) return; // no footer on the cover
    const label = `${index + 1}`;
    const { width: pageWidth } = page.getSize();
    page.drawText(label, {
      x: pageWidth / 2 - regular.widthOfTextAtSize(label, 8) / 2,
      y: 24,
      size: 8,
      font: regular,
      color: MUTED,
    });
  });

  onProgress(totalSteps, totalSteps, 'Finishing');
  return pdf.save();
}
