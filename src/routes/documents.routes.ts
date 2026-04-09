import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import { extractTextFromPDF } from '../services/pdf.service';
import { extractFactureData } from '../agents/extractor.agent';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const VALID_TYPES = ['devis', 'bon_commande', 'bon_livraison', 'bon_reception', 'email'];

// Upload a document PDF
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

    const docType = req.body.docType;
    if (!docType || !VALID_TYPES.includes(docType)) {
      res.status(400).json({ error: `docType required. Valid: ${VALID_TYPES.join(', ')}` });
      return;
    }

    const rawText = await extractTextFromPDF(req.file.buffer);
    const extracted = await extractFactureData(rawText);

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

    await redis.set(`document:${doc.id}`, JSON.stringify(doc));
    await redis.set(`document:${doc.id}:pdf`, req.file.buffer.toString('base64'));
    await redis.sadd('document:ids', doc.id);

    res.json({ success: true, document: doc });
  } catch (err: any) {
    console.error('Document upload error:', err);
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
