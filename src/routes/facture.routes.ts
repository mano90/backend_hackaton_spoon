import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import { extractTextFromPDF } from '../services/pdf.service';
import { extractFactureData } from '../agents/extractor.agent';
import { resolveFactureDuplicate } from '../agents/similarity.agent';
import { persistDocumentHashFromBase64, persistDocumentHashFromBuffer, sha256Buffer, unregisterDocumentHash } from '../services/document-hash.service';
import { Facture } from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Upload and process a facture PDF (with duplicate detection)
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const rawText = await extractTextFromPDF(req.file.buffer);
    const extracted = await extractFactureData(rawText);

    const facture: Facture = {
      id: uuidv4(),
      fileName: req.file.originalname,
      rawText,
      montant: extracted.montant || 0,
      date: extracted.date || '',
      fournisseur: extracted.fournisseur || '',
      reference: extracted.reference || '',
      type: 'facture',
      createdAt: new Date().toISOString(),
      contentSha256: sha256Buffer(req.file.buffer),
    };

    // Check for duplicates
    const existingIds = await redis.smembers('facture:ids');
    const existingFactures = (await Promise.all(
      existingIds.map(async (id: string) => {
        const data = await redis.get(`facture:${id}`);
        return data ? JSON.parse(data) : null;
      })
    )).filter(Boolean);

    const similarity = await resolveFactureDuplicate(
      req.file.buffer,
      {
        id: facture.id,
        montant: facture.montant,
        date: facture.date,
        fournisseur: facture.fournisseur,
        reference: facture.reference,
        rawText: facture.rawText,
        fileName: facture.fileName,
      },
      existingFactures.map((f: any) => ({ id: f.id, montant: f.montant, date: f.date, fournisseur: f.fournisseur, reference: f.reference, fileName: f.fileName }))
    );

    if (similarity.hasDuplicate && similarity.confidence >= 70) {
      // Store pending facture temporarily (expires in 10 min)
      const pendingKey = `facture:pending:${facture.id}`;
      await redis.set(pendingKey, JSON.stringify(facture), 'EX', 600);
      await redis.set(`${pendingKey}:pdf`, req.file.buffer.toString('base64'), 'EX', 600);

      let existingFacture: any = null;
      if (similarity.duplicateId) {
        const raw =
          (await redis.get(`facture:${similarity.duplicateId}`)) ??
          (await redis.get(`document:${similarity.duplicateId}`));
        existingFacture = raw ? JSON.parse(raw) : null;
      }

      res.json({
        success: false,
        needsConfirmation: true,
        pendingFacture: facture,
        similarity: {
          duplicateId: similarity.duplicateId,
          confidence: similarity.confidence,
          reason: similarity.reason,
          existingFacture,
          matchLayer: similarity.matchLayer,
          matchType: similarity.matchType,
          contentSha256: similarity.contentSha256,
        },
      });
      return;
    }

    // No duplicate: save directly
    await persistDocumentHashFromBuffer(facture as unknown as Record<string, unknown>, req.file.buffer);
    await redis.set(`facture:${facture.id}`, JSON.stringify(facture));
    await redis.set(`facture:${facture.id}:pdf`, req.file.buffer.toString('base64'));
    await redis.sadd('facture:ids', facture.id);

    res.json({ success: true, facture });
  } catch (err: any) {
    console.error('Facture upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Confirm a pending facture (user chose to add it)
router.post('/confirm/:pendingId', async (req: Request, res: Response) => {
  try {
    const { pendingId } = req.params;
    const pendingKey = `facture:pending:${pendingId}`;

    const data = await redis.get(pendingKey);
    const pdfData = await redis.get(`${pendingKey}:pdf`);

    if (!data) {
      res.status(404).json({ error: 'Pending facture expired or not found' });
      return;
    }

    const facture = JSON.parse(data) as Facture;

    if (pdfData) {
      await persistDocumentHashFromBase64(facture as unknown as Record<string, unknown>, pdfData);
    }

    await redis.set(`facture:${facture.id}`, JSON.stringify(facture));
    if (pdfData) await redis.set(`facture:${facture.id}:pdf`, pdfData);
    await redis.sadd('facture:ids', facture.id);

    // Clean up pending
    await redis.del(pendingKey, `${pendingKey}:pdf`);

    res.json({ success: true, facture });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Replace an existing facture with a pending one
router.post('/replace/:pendingId/:existingId', async (req: Request, res: Response) => {
  try {
    const { pendingId, existingId } = req.params;
    const pendingKey = `facture:pending:${pendingId}`;

    const data = await redis.get(pendingKey);
    const pdfData = await redis.get(`${pendingKey}:pdf`);

    if (!data) {
      res.status(404).json({ error: 'Pending facture expired or not found' });
      return;
    }

    const facture = JSON.parse(data) as Facture;

    const oldRaw = await redis.get(`facture:${existingId}`);
    if (oldRaw) {
      const oldF = JSON.parse(oldRaw) as Facture;
      if (oldF.contentSha256) await unregisterDocumentHash(oldF.contentSha256, String(existingId));
    }

    // Delete existing
    await redis.del(`facture:${existingId}`, `facture:${existingId}:pdf`);
    await redis.srem('facture:ids', existingId as string);

    // Save new
    if (pdfData) {
      await persistDocumentHashFromBase64(facture as unknown as Record<string, unknown>, pdfData);
    }
    await redis.set(`facture:${facture.id}`, JSON.stringify(facture));
    if (pdfData) await redis.set(`facture:${facture.id}:pdf`, pdfData);
    await redis.sadd('facture:ids', facture.id);

    // Clean up pending
    await redis.del(pendingKey, `${pendingKey}:pdf`);

    res.json({ success: true, facture, replacedId: existingId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel a pending facture
router.delete('/pending/:pendingId', async (req: Request, res: Response) => {
  try {
    const pendingKey = `facture:pending:${req.params.pendingId}`;
    await redis.del(pendingKey, `${pendingKey}:pdf`);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all factures
router.get('/', async (_req: Request, res: Response) => {
  try {
    const ids = await redis.smembers('facture:ids');
    const factures = await Promise.all(
      ids.map(async (id: string) => {
        const data = await redis.get(`facture:${id}`);
        return data ? JSON.parse(data) : null;
      })
    );
    res.json(factures.filter(Boolean));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get one facture
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const data = await redis.get(`facture:${req.params.id}`);
    if (!data) {
      res.status(404).json({ error: 'Facture not found' });
      return;
    }
    res.json(JSON.parse(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get facture PDF
router.get('/:id/pdf', async (req: Request, res: Response) => {
  try {
    const pdfBase64 = await redis.get(`facture:${req.params.id}:pdf`);
    if (!pdfBase64) {
      res.status(404).json({ error: 'PDF not found' });
      return;
    }
    const buffer = Buffer.from(pdfBase64, 'base64');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': buffer.length.toString() });
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a facture
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const raw = await redis.get(`facture:${req.params.id}`);
    if (raw) {
      const f = JSON.parse(raw) as Facture;
      if (f.contentSha256) await unregisterDocumentHash(f.contentSha256, String(req.params.id));
    }
    await redis.del(`facture:${req.params.id}`, `facture:${req.params.id}:pdf`);
    await redis.srem('facture:ids', req.params.id as string);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
