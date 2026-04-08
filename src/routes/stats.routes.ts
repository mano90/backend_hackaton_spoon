import { Router, Request, Response } from 'express';
import redis from '../services/redis.service';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const factureCount = await redis.scard('facture:ids');
    const mouvementCount = await redis.scard('mouvement:ids');
    const rapprochementCount = await redis.scard('rapprochement:ids');

    // Calculate totals
    const factureIds = await redis.smembers('facture:ids');
    let totalFactures = 0;
    for (const id of factureIds) {
      const data = await redis.get(`facture:${id}`);
      if (data) totalFactures += JSON.parse(data).montant || 0;
    }

    const mouvementIds = await redis.smembers('mouvement:ids');
    let totalEntrees = 0;
    let totalSorties = 0;
    for (const id of mouvementIds) {
      const data = await redis.get(`mouvement:${id}`);
      if (data) {
        const m = JSON.parse(data);
        if (m.type_mouvement === 'entree') totalEntrees += m.montant || 0;
        else totalSorties += m.montant || 0;
      }
    }

    // Rapprochement stats
    const rapprochementIds = await redis.smembers('rapprochement:ids');
    let exact = 0, partial = 0, noMatch = 0;
    for (const id of rapprochementIds) {
      const data = await redis.get(`rapprochement:${id}`);
      if (data) {
        const r = JSON.parse(data);
        if (r.status === 'exact') exact++;
        else if (r.status === 'partial') partial++;
        else noMatch++;
      }
    }

    res.json({
      factures: { count: factureCount, total: totalFactures },
      mouvements: { count: mouvementCount, totalEntrees, totalSorties },
      rapprochements: { count: rapprochementCount, exact, partial, noMatch },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
