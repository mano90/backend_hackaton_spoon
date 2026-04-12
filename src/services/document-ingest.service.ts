import { v4 as uuidv4 } from 'uuid';
import redis from './redis.service';
import { extractTextFromPDF } from './pdf.service';
import { extractFactureData } from '../agents/extractor.agent';
import { classifyDocument, type ClassificationResult } from '../agents/classifier.agent';
import { resolveFactureDuplicate } from '../agents/similarity.agent';
import { persistDocumentHashFromBuffer, sha256Buffer } from './document-hash.service';

export const VALID_DOC_TYPES = ['devis', 'bon_commande', 'bon_livraison', 'bon_reception', 'facture', 'email'] as const;
export const CONFIDENCE_THRESHOLD = 75;

export type IngestSaved = {
  kind: 'saved';
  document: Record<string, unknown>;
  classification: ClassificationResult;
};

export type IngestPendingClassification = {
  kind: 'pending_classification';
  pendingDocument: Record<string, unknown>;
  classification: ClassificationResult;
  pdfBase64: string;
};

export type IngestPendingDuplicate = {
  kind: 'pending_duplicate';
  pendingDocument: Record<string, unknown>;
  similarity: {
    duplicateId: string;
    confidence: number;
    reason: string;
    existingDocument: Record<string, unknown> | null;
    matchLayer?: string;
    matchType?: string;
    contentSha256?: string;
  };
  pdfBase64: string;
};

export type IngestError = {
  kind: 'error';
  message: string;
};

export type IngestResult = IngestSaved | IngestPendingClassification | IngestPendingDuplicate | IngestError;

/**
 * Extraction + classification + persistance (ou pending) pour un PDF — logique partagée upload simple / batch.
 */
export async function ingestOnePdf(
  buffer: Buffer,
  originalName: string,
  body?: { docType?: string; /** défaut true : un dossier (scenarioId) par PDF ; false pour batch avant regroupement agent */ assignDefaultScenarioId?: boolean }
): Promise<IngestResult> {
  try {
    const rawText = await extractTextFromPDF(buffer);
    const extracted = await extractFactureData(rawText);
    const classification = await classifyDocument(rawText, originalName);

    const forcedType = body?.docType;
    const docType =
      forcedType && VALID_DOC_TYPES.includes(forcedType as (typeof VALID_DOC_TYPES)[number])
        ? forcedType
        : classification.docType;
    const isUncertain = !forcedType && classification.confidence < CONFIDENCE_THRESHOLD;

    const doc: Record<string, unknown> = {
      id: uuidv4(),
      fileName: originalName,
      rawText,
      docType,
      montant: extracted.montant ?? null,
      date: extracted.date || '',
      fournisseur: extracted.fournisseur || '',
      reference: extracted.reference || '',
      type: docType,
      createdAt: new Date().toISOString(),
    };

    if (isUncertain) {
      const pendingKey = `document:pending:${doc.id}`;
      await redis.set(pendingKey, JSON.stringify(doc), 'EX', 600);
      await redis.set(`${pendingKey}:pdf`, buffer.toString('base64'), 'EX', 600);

      return {
        kind: 'pending_classification',
        pendingDocument: doc,
        classification,
        pdfBase64: buffer.toString('base64'),
      };
    }

    if (docType === 'facture') {
      doc.contentSha256 = sha256Buffer(buffer);

      const existingIds = await redis.smembers('document:ids');
      const existingFactures = (
        await Promise.all(
          existingIds.map(async (id: string) => {
            const data = await redis.get(`document:${id}`);
            if (!data) return null;
            const d = JSON.parse(data);
            return d.docType === 'facture' ? d : null;
          })
        )
      ).filter(Boolean) as Record<string, unknown>[];

      const similarity = await resolveFactureDuplicate(
        buffer,
        {
          id: doc.id as string,
          montant: (doc.montant as number) || 0,
          date: doc.date as string,
          fournisseur: doc.fournisseur as string,
          reference: doc.reference as string,
          rawText: doc.rawText as string,
          fileName: originalName,
        },
        existingFactures.map((f: Record<string, unknown>) => ({
          id: f.id as string,
          montant: (f.montant as number) || 0,
          date: f.date as string,
          fournisseur: f.fournisseur as string,
          reference: f.reference as string,
          fileName: f.fileName as string,
        }))
      );

      if (similarity.hasDuplicate && similarity.confidence >= 70) {
        const pendingKey = `document:pending:${doc.id}`;
        await redis.set(pendingKey, JSON.stringify(doc), 'EX', 600);
        await redis.set(`${pendingKey}:pdf`, buffer.toString('base64'), 'EX', 600);

        let existingDocument: Record<string, unknown> | null = null;
        if (similarity.duplicateId) {
          const raw = await redis.get(`document:${similarity.duplicateId}`);
          existingDocument = raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
        }

        return {
          kind: 'pending_duplicate',
          pendingDocument: doc,
          similarity: {
            duplicateId: similarity.duplicateId!,
            confidence: similarity.confidence,
            reason: similarity.reason,
            existingDocument,
            matchLayer: similarity.matchLayer,
            matchType: similarity.matchType,
            contentSha256: similarity.contentSha256,
          },
          pdfBase64: buffer.toString('base64'),
        };
      }
    }

    if (body?.assignDefaultScenarioId !== false) {
      doc.scenarioId = uuidv4();
    }

    await persistDocumentHashFromBuffer(doc, buffer);
    await redis.set(`document:${doc.id}`, JSON.stringify(doc));
    await redis.set(`document:${doc.id}:pdf`, buffer.toString('base64'));
    await redis.sadd('document:ids', doc.id as string);

    return { kind: 'saved', document: doc, classification };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { kind: 'error', message };
  }
}
