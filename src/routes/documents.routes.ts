import { Router, Request, Response } from 'express';
import redis from '../services/redis.service';

const router = Router();

// Supported document types (excluding facture/mouvement which have their own routes)
const DOC_TYPES = ['devis', 'bon_commande', 'bon_livraison', 'bon_reception', 'email'] as const;

// Get all documents of a type
router.get('/:docType', async (req: Request, res: Response) => {
  try {
    const { docType } = req.params;
    if (!DOC_TYPES.includes(docType as any)) {
      res.status(400).json({ error: `Invalid document type. Use: ${DOC_TYPES.join(', ')}` });
      return;
    }
    const ids = await redis.smembers(`${docType}:ids`);
    const docs = await Promise.all(
      ids.map(async (id: string) => {
        const data = await redis.get(`${docType}:${id}`);
        return data ? JSON.parse(data) : null;
      })
    );
    res.json(docs.filter(Boolean));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get one document
router.get('/:docType/:id', async (req: Request, res: Response) => {
  try {
    const { docType, id } = req.params;
    const data = await redis.get(`${docType}:${id}`);
    if (!data) { res.status(404).json({ error: 'Not found' }); return; }
    res.json(JSON.parse(data));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get PDF for a document
router.get('/:docType/:id/pdf', async (req: Request, res: Response) => {
  try {
    const { docType, id } = req.params;
    const pdfBase64 = await redis.get(`${docType}:${id}:pdf`);
    if (!pdfBase64) { res.status(404).json({ error: 'PDF not found' }); return; }
    const buffer = Buffer.from(pdfBase64, 'base64');
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': buffer.length.toString() });
    res.send(buffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete a document
router.delete('/:docType/:id', async (req: Request, res: Response) => {
  try {
    const { docType, id } = req.params;
    await redis.del(`${docType}:${id}`, `${docType}:${id}:pdf`);
    await redis.srem(`${docType}:ids`, id as string);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
