import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import { ingestOnePdf, VALID_DOC_TYPES } from '../services/document-ingest.service';
import { linkDocumentsIntoDossiers, type DossierLinkInput } from '../agents/dossier-link.agent';
import {
  clusterFactureDuplicates,
  type ClusterEdgeReason,
  type DuplicateGroup,
} from '../services/facture-cluster.service';
import { backfillMissingContentSha256, persistDocumentHashFromBase64, unregisterDocumentHash } from '../services/document-hash.service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const DUPLICATE_REASON_LABELS_FR: Record<ClusterEdgeReason, string> = {
  byte_identical: 'Fichier identique (empreinte SHA-256)',
  strict_triplet: 'Même fournisseur, montant et référence',
  human_error_amount: 'Montants très proches (erreur de saisie possible)',
  multi_channel: 'Doublon multi-canal (analyse sémantique)',
};

function syntheticSimilarityPercent(reasons: ClusterEdgeReason[]): number | null {
  if (!reasons.length) return null;
  const byReason: Partial<Record<ClusterEdgeReason, number>> = {
    byte_identical: 100,
    strict_triplet: 95,
    human_error_amount: 85,
    multi_channel: 75,
  };
  let max = 0;
  for (const r of reasons) {
    const s = byReason[r];
    if (s != null && s > max) max = s;
  }
  return max > 0 ? max : null;
}

interface EnrichedDuplicateGroup extends DuplicateGroup {
  documents: Record<string, unknown>[];
  reasonLabels: string[];
  syntheticSimilarity: number | null;
}

async function enrichDuplicateGroups(groups: DuplicateGroup[]): Promise<EnrichedDuplicateGroup[]> {
  const allIds = [...new Set(groups.flatMap((g) => g.ids))];
  const idToDoc = new Map<string, Record<string, unknown>>();
  await Promise.all(
    allIds.map(async (id) => {
      const raw = await redis.get(`document:${id}`);
      if (raw) {
        try {
          idToDoc.set(id, JSON.parse(raw) as Record<string, unknown>);
        } catch {
          /* skip */
        }
      }
    })
  );

  return groups.map((g) => {
    const documents = g.ids.map((id) => idToDoc.get(id)).filter((d): d is Record<string, unknown> => d != null);
    const reasonLabels = g.reasons.map((r) => DUPLICATE_REASON_LABELS_FR[r] ?? r);
    return {
      ...g,
      documents,
      reasonLabels,
      syntheticSimilarity: syntheticSimilarityPercent(g.reasons),
    };
  });
}

const BATCH_MAX_FILES = 30;
const uploadBatch = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: BATCH_MAX_FILES },
});

// Upload a document PDF (auto-classification)
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const result = await ingestOnePdf(req.file.buffer, req.file.originalname, {
      docType: req.body.docType,
    });

    if (result.kind === 'saved') {
      res.json({ success: true, document: result.document, classification: result.classification });
      return;
    }
    if (result.kind === 'pending_classification') {
      res.json({
        success: false,
        needsClassification: true,
        pendingDocument: result.pendingDocument,
        classification: {
          suggestedType: result.classification.docType,
          confidence: result.classification.confidence,
          reason: result.classification.reason,
        },
      });
      return;
    }
    if (result.kind === 'pending_duplicate') {
      res.json({
        success: false,
        needsConfirmation: true,
        pendingDocument: result.pendingDocument,
        similarity: result.similarity,
      });
      return;
    }
    res.status(500).json({ error: result.message });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Document upload error:', err);
    res.status(500).json({ error: message });
  }
});

/**
 * Import multiple PDFs : multer (champ "files"), lecture, extraction + agent classifieur,
 * enregistrement Redis, puis agent de regroupement pour relier les pièces en dossiers (scenarioId).
 */
router.post('/upload-batch', uploadBatch.array('files', BATCH_MAX_FILES), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files?.length) {
      res.status(400).json({
        error: 'Aucun fichier. Envoyez un multipart/form-data avec le champ "files" (un ou plusieurs PDF).',
      });
      return;
    }

    const results: Record<string, unknown>[] = [];
    const savedForLink: DossierLinkInput[] = [];

    for (const file of files) {
      const name = file.originalname || 'document.pdf';
      if (!name.toLowerCase().endsWith('.pdf')) {
        results.push({
          fileName: name,
          outcome: 'error',
          error: 'Seuls les fichiers .pdf sont acceptés',
        });
        continue;
      }

      const r = await ingestOnePdf(file.buffer, name, {
        docType: req.body?.docType,
        assignDefaultScenarioId: false,
      });

      if (r.kind === 'saved') {
        results.push({
          fileName: name,
          outcome: 'saved',
          document: r.document,
          classification: r.classification,
        });
        savedForLink.push({
          id: r.document.id as string,
          docType: String(r.document.docType ?? ''),
          fournisseur: String(r.document.fournisseur ?? ''),
          reference: String(r.document.reference ?? ''),
          date: String(r.document.date ?? ''),
        });
      } else if (r.kind === 'pending_classification') {
        results.push({
          fileName: name,
          outcome: 'pending_classification',
          pendingDocument: r.pendingDocument,
          classification: {
            suggestedType: r.classification.docType,
            confidence: r.classification.confidence,
            reason: r.classification.reason,
          },
        });
      } else if (r.kind === 'pending_duplicate') {
        results.push({
          fileName: name,
          outcome: 'pending_duplicate',
          pendingDocument: r.pendingDocument,
          similarity: r.similarity,
        });
      } else {
        results.push({ fileName: name, outcome: 'error', error: r.message });
      }
    }

    let dossiers: { scenarioId: string; documentIds: string[] }[] | undefined;

    if (savedForLink.length >= 1) {
      const idToScenario = await linkDocumentsIntoDossiers(savedForLink);
      const byScenario = new Map<string, string[]>();
      for (const [docId, scenarioId] of idToScenario.entries()) {
        const data = await redis.get(`document:${docId}`);
        if (!data) continue;
        const doc = JSON.parse(data) as Record<string, unknown>;
        doc.scenarioId = scenarioId;
        await redis.set(`document:${docId}`, JSON.stringify(doc));
        if (!byScenario.has(scenarioId)) byScenario.set(scenarioId, []);
        byScenario.get(scenarioId)!.push(docId);
      }
      dossiers = Array.from(byScenario.entries()).map(([scenarioId, documentIds]) => ({
        scenarioId,
        documentIds,
      }));
    }

    res.json({
      success: true,
      fileCount: files.length,
      results,
      dossiers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Document batch upload error:', err);
    res.status(500).json({ error: message });
  }
});

/** Regroupe les factures stockées en doublons potentiels (hash, règles, optionnellement LLM). */
router.get('/factures/duplicate-groups', async (req: Request, res: Response) => {
  try {
    const maxLlmCalls = Math.min(500, Math.max(0, Number(req.query.maxLlmCalls) || 0));
    const result = await clusterFactureDuplicates({ maxLlmCalls });
    const groups = await enrichDuplicateGroups(result.groups);
    res.json({ groups, llmCallsUsed: result.llmCallsUsed });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

/** Calcule les empreintes SHA-256 manquantes pour les PDF déjà stockés. */
router.post('/factures/backfill-hashes', async (_req: Request, res: Response) => {
  try {
    const result = await backfillMissingContentSha256();
    res.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Confirm a pending document (with optional type override)
router.post('/confirm/:pendingId', async (req: Request, res: Response) => {
  try {
    const { pendingId } = req.params;
    const pendingKey = `document:pending:${pendingId}`;
    const data = await redis.get(pendingKey);
    const pdfData = await redis.get(`${pendingKey}:pdf`);
    if (!data) {
      res.status(404).json({ error: 'Pending document expired or not found' });
      return;
    }

    const doc = JSON.parse(data) as Record<string, unknown>;
    if (req.body.docType && VALID_DOC_TYPES.includes(req.body.docType as (typeof VALID_DOC_TYPES)[number])) {
      doc.docType = req.body.docType;
      doc.type = req.body.docType;
    }

    if (doc.scenarioId == null) {
      doc.scenarioId = uuidv4();
    }

    if (pdfData) {
      await persistDocumentHashFromBase64(doc, pdfData);
    }

    await redis.set(`document:${doc.id}`, JSON.stringify(doc));
    if (pdfData) await redis.set(`document:${doc.id}:pdf`, pdfData);
    await redis.sadd('document:ids', doc.id as string);
    await redis.del(pendingKey, `${pendingKey}:pdf`);

    res.json({ success: true, document: doc });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Replace an existing document with a pending one
router.post('/replace/:pendingId/:existingId', async (req: Request, res: Response) => {
  try {
    const { pendingId, existingId } = req.params;
    const pendingKey = `document:pending:${pendingId}`;
    const data = await redis.get(pendingKey);
    const pdfData = await redis.get(`${pendingKey}:pdf`);
    if (!data) {
      res.status(404).json({ error: 'Pending document expired or not found' });
      return;
    }

    const doc = JSON.parse(data) as Record<string, unknown>;
    const oldRaw = await redis.get(`document:${existingId}`);
    if (oldRaw) {
      const oldDoc = JSON.parse(oldRaw) as Record<string, unknown>;
      const oh = oldDoc.contentSha256;
      if (typeof oh === 'string') await unregisterDocumentHash(oh, String(existingId));
    }
    await redis.del(`document:${existingId}`, `document:${existingId}:pdf`);
    await redis.srem('document:ids', existingId as string);
    if (pdfData) {
      await persistDocumentHashFromBase64(doc, pdfData);
    }
    await redis.set(`document:${doc.id}`, JSON.stringify(doc));
    if (pdfData) await redis.set(`document:${doc.id}:pdf`, pdfData);
    await redis.sadd('document:ids', doc.id);
    await redis.del(pendingKey, `${pendingKey}:pdf`);

    res.json({ success: true, document: doc, replacedId: existingId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Cancel a pending document
router.delete('/pending/:pendingId', async (req: Request, res: Response) => {
  try {
    const pendingKey = `document:pending:${req.params.pendingId}`;
    await redis.del(pendingKey, `${pendingKey}:pdf`);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Get all documents (optional ?type= filter)
router.get('/', async (req: Request, res: Response) => {
  try {
    const typeFilter = req.query.type as string | undefined;
    const ids = await redis.smembers('document:ids');
    const docs = (
      await Promise.all(
        ids.map(async (id: string) => {
          const d = await redis.get(`document:${id}`);
          return d ? JSON.parse(d) : null;
        })
      )
    ).filter(Boolean);

    if (typeFilter) {
      res.json(docs.filter((d: { docType?: string; type?: string }) => d.docType === typeFilter || d.type === typeFilter));
    } else {
      res.json(docs);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Get pending document PDF
router.get('/pending/:pendingId/pdf', async (req: Request, res: Response) => {
  try {
    const pdfBase64 = await redis.get(`document:pending:${req.params.pendingId}:pdf`);
    if (!pdfBase64) {
      res.status(404).json({ error: 'PDF not found' });
      return;
    }
    const buffer = Buffer.from(pdfBase64, 'base64');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': buffer.length.toString() });
    res.send(buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Get one document
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const data = await redis.get(`document:${req.params.id}`);
    if (!data) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(JSON.parse(data));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Get document PDF
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const pdfBase64 = await redis.get(`document:${req.params.id}:pdf`);
    if (!pdfBase64) {
      res.status(404).json({ error: 'PDF not found' });
      return;
    }
    const buffer = Buffer.from(pdfBase64, 'base64');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': buffer.length.toString() });
    res.send(buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Delete a document
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const existing = await redis.get(`document:${req.params.id}`);
    if (existing) {
      const oldDoc = JSON.parse(existing) as Record<string, unknown>;
      const oh = oldDoc.contentSha256;
      if (typeof oh === 'string') await unregisterDocumentHash(oh, String(req.params.id));
    }
    await redis.del(`document:${req.params.id}`, `document:${req.params.id}:pdf`);
    await redis.srem('document:ids', req.params.id as string);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
