import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import { extractTextFromPDF } from '../services/pdf.service';
import { extractMouvementData } from '../agents/extractor.agent';
import { MouvementBancaire } from '../types';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Upload and process a bank statement PDF
router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    const rawText = await extractTextFromPDF(req.file.buffer);
    const extractedList = await extractMouvementData(rawText);

    const mouvements: MouvementBancaire[] = (Array.isArray(extractedList) ? extractedList : [extractedList]).map(
      (m: any) => ({
        id: uuidv4(),
        fileName: req.file!.originalname,
        rawText,
        montant: m.montant || 0,
        date: m.date || '',
        libelle: m.libelle || '',
        type_mouvement: m.type_mouvement || 'sortie',
        reference: m.reference || '',
        type: 'mouvement' as const,
        createdAt: new Date().toISOString(),
      })
    );

    const pipeline = redis.pipeline();
    for (const mouvement of mouvements) {
      pipeline.set(`mouvement:${mouvement.id}`, JSON.stringify(mouvement));
      pipeline.sadd('mouvement:ids', mouvement.id);
    }
    await pipeline.exec();

    res.json({ success: true, count: mouvements.length, mouvements });
  } catch (err: any) {
    console.error('Mouvement upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all mouvements
router.get('/', async (_req: Request, res: Response) => {
  try {
    const ids = await redis.smembers('mouvement:ids');
    const mouvements = await Promise.all(
      ids.map(async (id) => {
        const data = await redis.get(`mouvement:${id}`);
        return data ? JSON.parse(data) : null;
      })
    );
    res.json(mouvements.filter(Boolean));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get one mouvement
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const data = await redis.get(`mouvement:${req.params.id}`);
    if (!data) {
      res.status(404).json({ error: 'Mouvement not found' });
      return;
    }
    res.json(JSON.parse(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a mouvement
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await redis.del(`mouvement:${req.params.id}`);
    await redis.srem('mouvement:ids', req.params.id as string);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
