import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import { extractTextFromPDF } from '../services/pdf.service';
import { extractFactureData } from '../agents/extractor.agent';
import { Facture } from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Upload and process a facture PDF
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
    };

    await redis.set(`facture:${facture.id}`, JSON.stringify(facture));
    await redis.sadd('facture:ids', facture.id);

    res.json({ success: true, facture });
  } catch (err: any) {
    console.error('Facture upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all factures
router.get('/', async (_req: Request, res: Response) => {
  try {
    const ids = await redis.smembers('facture:ids');
    const factures = await Promise.all(
      ids.map(async (id) => {
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

// Delete a facture
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await redis.del(`facture:${req.params.id}`);
    await redis.srem('facture:ids', req.params.id as string);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
