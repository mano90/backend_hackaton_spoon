import { PDFDocument } from 'pdf-lib';
import type { PdfMetadataFields } from '../types';

function toIso(d: unknown): string | undefined {
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  return undefined;
}

export async function extractPdfMetadata(buffer: Buffer): Promise<PdfMetadataFields> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
    const title = doc.getTitle();
    const creator = doc.getCreator();
    const producer = doc.getProducer();
    return {
      title: title || undefined,
      creator: creator || undefined,
      producer: producer || undefined,
      creationDate: toIso(doc.getCreationDate()),
      modificationDate: toIso(doc.getModificationDate()),
    };
  } catch {
    return {};
  }
}
