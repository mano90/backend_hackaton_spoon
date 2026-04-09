import { Router, Request, Response } from 'express';
import redis from '../services/redis.service';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    // All documents
    const docIds = await redis.smembers('document:ids');
    const docs = (await Promise.all(
      docIds.map(async (id: string) => {
        const data = await redis.get(`document:${id}`);
        return data ? JSON.parse(data) : null;
      })
    )).filter(Boolean);

    const factures = docs.filter((d: any) => d.docType === 'facture' || d.type === 'facture');
    const totalFactures = factures.reduce((s: number, f: any) => s + (f.montant || 0), 0);

    // Mouvements
    const mouvementIds = await redis.smembers('mouvement:ids');
    let totalEntrees = 0, totalSorties = 0;
    for (const id of mouvementIds) {
      const data = await redis.get(`mouvement:${id}`);
      if (data) {
        const m = JSON.parse(data);
        if (m.type_mouvement === 'entree') totalEntrees += m.montant || 0;
        else totalSorties += m.montant || 0;
      }
    }

    // Rapprochements
    const rappIds = await redis.smembers('rapprochement:ids');
    let exact = 0, partial = 0, noMatch = 0;
    for (const id of rappIds) {
      const data = await redis.get(`rapprochement:${id}`);
      if (data) {
        const r = JSON.parse(data);
        if (r.status === 'exact') exact++;
        else if (r.status === 'partial') partial++;
        else noMatch++;
      }
    }

    res.json({
      factures: { count: factures.length, total: totalFactures },
      documents: { count: docs.length },
      mouvements: { count: mouvementIds.length, totalEntrees, totalSorties },
      rapprochements: { count: rappIds.length, exact, partial, noMatch },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
