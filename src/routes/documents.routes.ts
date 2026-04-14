import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import {
  ingestOnePdf,
  INGEST_STEP_COUNT,
  VALID_DOC_TYPES,
  shouldCheckDuplicate,
  tryCreateDuplicatePending,
} from '../services/document-ingest.service';
import { linkDocumentsIntoDossiers, type DossierLinkInput } from '../agents/dossier-link.agent';
import { emitDocumentsBatchProgress } from '../services/realtime-import.service';

/** Réception (1) + sous-étapes ingest (INGEST_STEP_COUNT) */
const BATCH_FILE_STEP_COUNT = 1 + INGEST_STEP_COUNT;

function percentForFileSubstep(fileIdx: number, fileTotal: number, step1Based: number, stepTotal: number): number {
  const lo = Math.min(88, 5 + Math.round(((fileIdx - 1) / fileTotal) * 83));
  const hi = Math.min(88, 5 + Math.round((fileIdx / fileTotal) * 83));
  if (hi <= lo || stepTotal <= 0) return lo;
  return Math.round(lo + (step1Based / stepTotal) * (hi - lo));
}

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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
      emitDocumentsBatchProgress({ phase: 'error', message: 'Aucun fichier', percent: 0 });
      res.status(400).json({
        error: 'Aucun fichier. Envoyez un multipart/form-data avec le champ "files" (un ou plusieurs PDF).',
      });
      return;
    }

    const n = files.length;
    emitDocumentsBatchProgress({
      phase: 'started',
      message: `Téléversement reçu — ${n} fichier(s) à traiter`,
      percent: 3,
      total: n,
    });

    const results: Record<string, unknown>[] = [];
    const savedForLink: DossierLinkInput[] = [];

    let idx = 0;
    for (const file of files) {
      idx += 1;
      const name = file.originalname || 'document.pdf';
      const basePct = (i: number) => Math.min(88, 5 + Math.round((i / n) * 83));

      if (!name.toLowerCase().endsWith('.pdf')) {
        emitDocumentsBatchProgress({
          phase: 'processing',
          message: `Ignoré (non PDF) : ${name}`,
          percent: basePct(idx),
          fileName: name,
          index: idx,
          total: n,
          outcome: 'error',
        });
        results.push({
          fileName: name,
          outcome: 'error',
          error: 'Seuls les fichiers .pdf sont acceptés',
        });
        continue;
      }

      emitDocumentsBatchProgress({
        phase: 'processing',
        message: `Réception du fichier en mémoire — fichier ${idx}/${n} — ${name}`,
        percent: percentForFileSubstep(idx, n, 1, BATCH_FILE_STEP_COUNT),
        fileName: name,
        index: idx,
        total: n,
        stage: 'receive',
        step: 1,
        stepCount: BATCH_FILE_STEP_COUNT,
      });

      const r = await ingestOnePdf(
        file.buffer,
        name,
        {
          docType: req.body?.docType,
          assignDefaultScenarioId: false,
        },
        (info) => {
          emitDocumentsBatchProgress({
            phase: 'processing',
            message: `${info.label} — fichier ${idx}/${n} — ${name}`,
            percent: percentForFileSubstep(idx, n, info.stepIndex + 2, BATCH_FILE_STEP_COUNT),
            fileName: name,
            index: idx,
            total: n,
            stage: info.stage,
            step: info.stepIndex + 2,
            stepCount: BATCH_FILE_STEP_COUNT,
          });
        }
      );

      let outcomeLabel = '';
      if (r.kind === 'saved') {
        outcomeLabel = `Enregistré (${String(r.document.docType ?? r.document.type ?? '?')})`;
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
        outcomeLabel = 'En attente de classification';
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
        outcomeLabel = 'Doublon détecté — confirmation requise';
        results.push({
          fileName: name,
          outcome: 'pending_duplicate',
          pendingDocument: r.pendingDocument,
          similarity: r.similarity,
        });
      } else {
        outcomeLabel = r.message || 'Erreur';
        results.push({ fileName: name, outcome: 'error', error: r.message });
      }

      emitDocumentsBatchProgress({
        phase: 'processing',
        message: `${name} — ${outcomeLabel}`,
        percent: basePct(idx),
        fileName: name,
        index: idx,
        total: n,
        outcome: outcomeLabel,
      });
    }

    let dossiers: { scenarioId: string; documentIds: string[] }[] | undefined;

    if (savedForLink.length >= 1) {
      emitDocumentsBatchProgress({
        phase: 'linking',
        message: `Liaison des dossiers (${savedForLink.length} pièce(s))…`,
        percent: 90,
        total: n,
      });
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

    emitDocumentsBatchProgress({
      phase: 'done',
      message: dossiers?.length
        ? `Terminé — ${dossiers.length} dossier(s) relié(s)`
        : 'Terminé',
      percent: 100,
      total: n,
    });

    res.json({
      success: true,
      fileCount: files.length,
      results,
      dossiers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Document batch upload error:', err);
    emitDocumentsBatchProgress({ phase: 'error', message, percent: 0 });
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
    delete doc.pendingKind;
    delete doc.similarity;
    if (req.body.docType && VALID_DOC_TYPES.includes(req.body.docType as (typeof VALID_DOC_TYPES)[number])) {
      doc.docType = req.body.docType;
      doc.type = req.body.docType;
    }

    const resolvedType = String(doc.docType ?? doc.type ?? '');
    if (pdfData && shouldCheckDuplicate(resolvedType)) {
      const buffer = Buffer.from(pdfData, 'base64');
      const dup = await tryCreateDuplicatePending(doc, buffer, resolvedType);
      if (dup) {
        await redis.set(pendingKey, JSON.stringify(doc), 'EX', 600);
        await redis.set(`${pendingKey}:pdf`, pdfData, 'EX', 600);
        res.json({
          success: false,
          needsConfirmation: true,
          pendingDocument: dup.pendingDocument,
          similarity: dup.similarity,
        });
        return;
      }
    }

    delete doc.pendingKind;
    delete doc.similarity;

    if (doc.scenarioId == null) {
      doc.scenarioId = uuidv4();
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
    delete doc.pendingKind;
    delete doc.similarity;
    await redis.del(`document:${existingId}`, `document:${existingId}:pdf`);
    await redis.srem('document:ids', existingId as string);
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

/** Liste des imports en attente (Redis), sans le PDF ni le texte brut — pour UI onglet / notifications. */
router.get('/pending-list', async (_req: Request, res: Response) => {
  try {
    const keys = await redis.keys('document:pending:*');
    const metaKeys = keys.filter((k: string) => !k.endsWith(':pdf'));
    const items: Record<string, unknown>[] = [];
    for (const key of metaKeys) {
      const raw = await redis.get(key);
      if (!raw) continue;
      const doc = JSON.parse(raw) as Record<string, unknown>;
      const id = String(doc.id ?? key.replace(/^document:pending:/, ''));
      const { rawText: _rt, ...rest } = doc;
      const sim = doc.similarity as { duplicateId?: string } | undefined;
      const inferredDuplicate = typeof sim?.duplicateId === 'string' && sim.duplicateId.length > 0;
      const pendingKind =
        (doc.pendingKind as string | undefined) ??
        (inferredDuplicate ? 'duplicate' : 'classification');
      items.push({
        id,
        pendingKind,
        fileName: doc.fileName,
        docType: doc.docType ?? doc.type,
        reference: doc.reference,
        fournisseur: doc.fournisseur,
        date: doc.date,
        montant: doc.montant,
        similarity: doc.similarity ?? null,
        pendingDocument: { ...rest, id },
      });
    }
    items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    res.json({ items });
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

// Inject raw documents for testing (no PDF required)
router.post('/inject', async (req: Request, res: Response) => {
  try {
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Body must be a non-empty array of documents' });
      return;
    }
    const ids: string[] = [];
    for (const item of items) {
      const id = uuidv4();
      const doc = { id, rawText: '', fileName: `${item.reference || id}.pdf`, createdAt: new Date().toISOString(), ...item };
      await redis.set(`document:${id}`, JSON.stringify(doc));
      await redis.sadd('document:ids', id);
      ids.push(id);
    }
    res.json({ success: true, count: ids.length, ids });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// Delete a document
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await redis.del(`document:${req.params.id}`, `document:${req.params.id}:pdf`);
    await redis.srem('document:ids', req.params.id as string);
    res.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
