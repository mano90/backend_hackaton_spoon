import { v4 as uuidv4 } from 'uuid';
import redis from './redis.service';
import { extractTextFromPDF } from './pdf.service';
import { extractFactureData } from '../agents/extractor.agent';
import { classifyDocument, type ClassificationResult } from '../agents/classifier.agent';
import { checkFactureSimilarity } from '../agents/similarity.agent';

export const VALID_DOC_TYPES = ['devis', 'bon_commande', 'bon_livraison', 'bon_reception', 'facture', 'email'] as const;
export const CONFIDENCE_THRESHOLD = 75;

/** Tous les types PDF métier sauf `email` (pièces comparées entre elles par type). */
export function shouldCheckDuplicate(docType: string): boolean {
  return (
    VALID_DOC_TYPES.includes(docType as (typeof VALID_DOC_TYPES)[number]) && docType !== 'email'
  );
}

function duplicatePluralLabel(docType: string): string {
  const m: Record<string, string> = {
    facture: 'factures',
    bon_commande: 'bons de commande',
    devis: 'devis',
    bon_livraison: 'bons de livraison',
    bon_reception: 'bons de réception',
  };
  return m[docType] ?? docType;
}

/**
 * Détecte un doublon fort vs documents déjà enregistrés du même type ; met à jour `doc` (pendingKind, similarity) si oui.
 * N’écrit pas Redis — l’appelant persiste `document:pending:*` si besoin.
 *
 * @param pdfBuffer PDF (upload) ; si absent, la « taille fichier » pour l’agent vient du texte brut (import M3, etc.).
 */
export async function tryCreateDuplicatePending(
  doc: Record<string, unknown>,
  docType: string,
  pdfBuffer?: Buffer
): Promise<IngestPendingDuplicate | null> {
  if (!shouldCheckDuplicate(docType)) return null;

  const existingIds = await redis.smembers('document:ids');
  const existingSameType = (
    await Promise.all(
      existingIds.map(async (id: string) => {
        const data = await redis.get(`document:${id}`);
        if (!data) return null;
        const d = JSON.parse(data);
        return d.docType === docType ? d : null;
      })
    )
  ).filter(Boolean) as Record<string, unknown>[];

  if (existingSameType.length === 0) return null;

  const fileSize =
    pdfBuffer && pdfBuffer.length > 0
      ? pdfBuffer.length
      : Buffer.byteLength(String(doc.rawText ?? ''), 'utf8');

  const similarity = await checkFactureSimilarity(
    {
      montant: (doc.montant as number) || 0,
      date: doc.date as string,
      fournisseur: doc.fournisseur as string,
      reference: doc.reference as string,
      rawText: doc.rawText as string,
      fileSize,
    },
    existingSameType.map((f: Record<string, unknown>) => ({
      id: f.id as string,
      montant: (f.montant as number) || 0,
      date: f.date as string,
      fournisseur: f.fournisseur as string,
      reference: f.reference as string,
      fileName: f.fileName as string,
    })),
    docType
  );

  if (!similarity.hasDuplicate || similarity.confidence < 70) return null;

  const existingForPending = existingSameType.find(
    (f: Record<string, unknown>) => f.id === similarity.duplicateId
  ) as Record<string, unknown> | undefined;

  doc.pendingKind = 'duplicate';
  doc.similarity = {
    duplicateId: similarity.duplicateId!,
    confidence: similarity.confidence,
    reason: similarity.reason,
    existingFileName: (existingForPending?.fileName as string) || undefined,
  };

  const pdfBytes = pdfBuffer && pdfBuffer.length > 0 ? pdfBuffer : Buffer.alloc(0);
  return {
    kind: 'pending_duplicate',
    pendingDocument: doc,
    similarity: {
      duplicateId: similarity.duplicateId!,
      confidence: similarity.confidence,
      reason: similarity.reason,
      existingDocument:
        (existingSameType.find((f: Record<string, unknown>) => f.id === similarity.duplicateId) as
          | Record<string, unknown>
          | null) ?? null,
    },
    pdfBase64: pdfBytes.toString('base64'),
  };
}

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
  };
  pdfBase64: string;
};

export type IngestError = {
  kind: 'error';
  message: string;
};

export type IngestResult = IngestSaved | IngestPendingClassification | IngestPendingDuplicate | IngestError;

/** Sous-étapes d’ingestion après réception (batch) : indices 0 … INGEST_STEP_COUNT-1 */
export const INGEST_STEP_COUNT = 5;

export type IngestProgressCallback = (info: {
  stepIndex: number;
  stepTotal: number;
  stage: string;
  label: string;
}) => void;

/**
 * Extraction + classification + persistance (ou pending) pour un PDF — logique partagée upload simple / batch.
 */
export async function ingestOnePdf(
  buffer: Buffer,
  originalName: string,
  body?: { docType?: string; /** défaut true : un dossier (scenarioId) par PDF ; false pour batch avant regroupement agent */ assignDefaultScenarioId?: boolean },
  progress?: IngestProgressCallback
): Promise<IngestResult> {
  try {
    const p = (stepIndex: number, stage: string, label: string) =>
      progress?.({ stepIndex, stepTotal: INGEST_STEP_COUNT, stage, label });

    p(0, 'extract_text', 'Extraction du texte PDF');
    const rawText = await extractTextFromPDF(buffer);

    p(1, 'extract_fields', 'Extraction des champs (montant, date, fournisseur…)');
    const extracted = await extractFactureData(rawText);

    p(2, 'classify', 'Classification du type de document');
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
      p(3, 'persist_pending', 'Enregistrement provisoire (classification incertaine)');
      doc.pendingKind = 'classification';
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

    if (shouldCheckDuplicate(docType)) {
      p(3, 'verify_duplicate', `Vérification des doublons (${duplicatePluralLabel(docType)})`);
      const dup = await tryCreateDuplicatePending(doc, docType, buffer);
      if (dup) {
        p(4, 'persist_pending', 'Enregistrement provisoire (doublon détecté)');
        const pendingKey = `document:pending:${doc.id}`;
        await redis.set(pendingKey, JSON.stringify(doc), 'EX', 600);
        await redis.set(`${pendingKey}:pdf`, buffer.toString('base64'), 'EX', 600);
        return dup;
      }
    } else {
      p(3, 'verify', 'Contrôle avant enregistrement');
    }

    p(4, 'persist', 'Enregistrement en base de données');
    await redis.set(`document:${doc.id}`, JSON.stringify(doc));
    await redis.set(`document:${doc.id}:pdf`, buffer.toString('base64'));
    await redis.sadd('document:ids', doc.id as string);

    if (body?.assignDefaultScenarioId !== false) {
      doc.scenarioId = uuidv4();
      await redis.set(`document:${doc.id}`, JSON.stringify(doc));
    }

    return { kind: 'saved', document: doc, classification };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { kind: 'error', message };
  }
}
