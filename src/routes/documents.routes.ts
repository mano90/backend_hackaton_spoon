import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import { extractTextFromPDF } from '../services/pdf.service';
import { extractFactureData } from '../agents/extractor.agent';
import { classifyDocument } from '../agents/classifier.agent';
import { checkFactureSimilarity } from '../agents/similarity.agent';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const VALID_TYPES = ['devis', 'bon_commande', 'bon_livraison', 'bon_reception', 'facture', 'email'];
const CONFIDENCE_THRESHOLD = 75;

// Upload a document PDF (auto-classification)
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const rawText = await extractTextFromPDF(req.file.buffer);
    const extracted = await extractFactureData(rawText);

    // Classify the document
    const classification = await classifyDocument(rawText, req.file.originalname);
    // Allow override from body if user explicitly chose a type
    const forcedType = req.body.docType;
    const docType = (forcedType && VALID_TYPES.includes(forcedType)) ? forcedType : classification.docType;
    const isUncertain = !forcedType && classification.confidence < CONFIDENCE_THRESHOLD;

    const doc = {
      id: uuidv4(),
      fileName: req.file.originalname,
      rawText,
      docType,
      montant: extracted.montant || null,
      date: extracted.date || '',
      fournisseur: extracted.fournisseur || '',
      reference: extracted.reference || '',
      type: docType,
      createdAt: new Date().toISOString(),
    };

    if (isUncertain) {
      // Store as pending, let user confirm the type
      const pendingKey = `document:pending:${doc.id}`;
      await redis.set(pendingKey, JSON.stringify(doc), 'EX', 600);
      await redis.set(`${pendingKey}:pdf`, req.file.buffer.toString('base64'), 'EX', 600);

      res.json({
        success: false,
        needsClassification: true,
        pendingDocument: doc,
        classification: {
          suggestedType: classification.docType,
          confidence: classification.confidence,
          reason: classification.reason,
        },
      });
      return;
    }

    // Check for duplicates on factures
    if (docType === 'facture') {
      const existingIds = await redis.smembers('document:ids');
      const existingFactures = (await Promise.all(
        existingIds.map(async (id: string) => {
          const data = await redis.get(`document:${id}`);
          if (!data) return null;
          const d = JSON.parse(data);
          return d.docType === 'facture' ? d : null;
        })
      )).filter(Boolean);

      if (existingFactures.length > 0) {
        const similarity = await checkFactureSimilarity(
          { montant: doc.montant || 0, date: doc.date, fournisseur: doc.fournisseur, reference: doc.reference, rawText: doc.rawText, fileSize: req.file.size },
          existingFactures.map((f: any) => ({ id: f.id, montant: f.montant || 0, date: f.date, fournisseur: f.fournisseur, reference: f.reference, fileName: f.fileName }))
        );

        if (similarity.hasDuplicate && similarity.confidence >= 70) {
          const pendingKey = `document:pending:${doc.id}`;
          await redis.set(pendingKey, JSON.stringify(doc), 'EX', 600);
          await redis.set(`${pendingKey}:pdf`, req.file.buffer.toString('base64'), 'EX', 600);

          res.json({
            success: false,
            needsConfirmation: true,
            pendingDocument: doc,
            similarity: {
              duplicateId: similarity.duplicateId,
              confidence: similarity.confidence,
              reason: similarity.reason,
              existingDocument: existingFactures.find((f: any) => f.id === similarity.duplicateId) || null,
            },
          });
          return;
        }
      }
    }

    // Save directly
    await redis.set(`document:${doc.id}`, JSON.stringify(doc));
    await redis.set(`document:${doc.id}:pdf`, req.file.buffer.toString('base64'));
    await redis.sadd('document:ids', doc.id);

    res.json({ success: true, document: doc, classification });
  } catch (err: any) {
    console.error('Document upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Confirm a pending document (with optional type override)
router.post('/confirm/:pendingId', async (req: Request, res: Response) => {
  try {
    const { pendingId } = req.params;
    const pendingKey = `document:pending:${pendingId}`;
    const data = await redis.get(pendingKey);
    const pdfData = await redis.get(`${pendingKey}:pdf`);
    if (!data) { res.status(404).json({ error: 'Pending document expired or not found' }); return; }

    const doc = JSON.parse(data);
    // Allow type override
    if (req.body.docType && VALID_TYPES.includes(req.body.docType)) {
      doc.docType = req.body.docType;
      doc.type = req.body.docType;
    }

    await redis.set(`document:${doc.id}`, JSON.stringify(doc));
    if (pdfData) await redis.set(`document:${doc.id}:pdf`, pdfData);
    await redis.sadd('document:ids', doc.id);
    await redis.del(pendingKey, `${pendingKey}:pdf`);

    res.json({ success: true, document: doc });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Replace an existing document with a pending one
router.post('/replace/:pendingId/:existingId', async (req: Request, res: Response) => {
  try {
    const { pendingId, existingId } = req.params;
    const pendingKey = `document:pending:${pendingId}`;
    const data = await redis.get(pendingKey);
    const pdfData = await redis.get(`${pendingKey}:pdf`);
    if (!data) { res.status(404).json({ error: 'Pending document expired or not found' }); return; }

    const doc = JSON.parse(data);
    await redis.del(`document:${existingId}`, `document:${existingId}:pdf`);
    await redis.srem('document:ids', existingId as string);
    await redis.set(`document:${doc.id}`, JSON.stringify(doc));
    if (pdfData) await redis.set(`document:${doc.id}:pdf`, pdfData);
    await redis.sadd('document:ids', doc.id);
    await redis.del(pendingKey, `${pendingKey}:pdf`);

    res.json({ success: true, document: doc, replacedId: existingId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel a pending document
router.delete('/pending/:pendingId', async (req: Request, res: Response) => {
  try {
    const pendingKey = `document:pending:${req.params.pendingId}`;
    await redis.del(pendingKey, `${pendingKey}:pdf`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all documents (optional ?type= filter)
router.get('/', async (req: Request, res: Response) => {
  try {
    const typeFilter = req.query.type as string | undefined;
    const ids = await redis.smembers('document:ids');
    const docs = (await Promise.all(
      ids.map(async (id: string) => {
        const data = await redis.get(`document:${id}`);
        return data ? JSON.parse(data) : null;
      })
    )).filter(Boolean);

    if (typeFilter) {
      res.json(docs.filter((d: any) => d.docType === typeFilter || d.type === typeFilter));
    } else {
      res.json(docs);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get pending document PDF
router.get('/pending/:pendingId/pdf', async (req: Request, res: Response) => {
  try {
    const pdfBase64 = await redis.get(`document:pending:${req.params.pendingId}:pdf`);
    if (!pdfBase64) { res.status(404).json({ error: 'PDF not found' }); return; }
    const buffer = Buffer.from(pdfBase64, 'base64');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': buffer.length.toString() });
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get one document
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const data = await redis.get(`document:${req.params.id}`);
    if (!data) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(JSON.parse(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get document PDF
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const pdfBase64 = await redis.get(`document:${req.params.id}:pdf`);
    if (!pdfBase64) { res.status(404).json({ error: 'PDF not found' }); return; }
    const buffer = Buffer.from(pdfBase64, 'base64');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': buffer.length.toString() });
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a document
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await redis.del(`document:${req.params.id}`, `document:${req.params.id}:pdf`);
    await redis.srem('document:ids', req.params.id as string);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
