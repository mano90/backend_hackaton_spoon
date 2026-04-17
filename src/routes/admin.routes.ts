import { Router, Request, Response } from 'express';
import redis from '../services/redis.service';
import { seed } from '../seed';

const router = Router();

/** Supprime toutes les données métier (documents, mouvements, rapprochements, factures, sessions IA). */
router.delete('/clear-all', async (_req: Request, res: Response) => {
  try {
    const patterns = [
      'document:*',
      'mouvement:*',
      'rapprochement:*',
      'facture:*',
      'purchase_order:*',
      'supplier_invoice:*',
      'ai:chat:*',
    ];

    let deleted = 0;
    for (const pattern of patterns) {
      const keys: string[] = await redis.keys(pattern);
      if (keys.length > 0) {
        deleted += await redis.del(...keys);
      }
    }

    console.log(`[Admin] clear-all : ${deleted} clés supprimées`);
    res.json({ success: true, deleted });
  } catch (err: any) {
    console.error('[Admin] clear-all error:', err);
    res.status(500).json({ error: err.message });
  }
});

/** Recharge les données de seed. */
router.post('/seed', async (_req: Request, res: Response) => {
  try {
    console.log('[Admin] Rechargement du seed...');
    await seed();
    console.log('[Admin] Seed terminé.');
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Admin] seed error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
