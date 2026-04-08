import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import { performRapprochement } from '../agents/rapprochement.agent';
import { Facture, MouvementBancaire, Rapprochement } from '../types';

const router = Router();

// Run rapprochement for a specific mouvement
router.post('/run/:mouvementId', async (req: Request, res: Response) => {
  try {
    const mouvementData = await redis.get(`mouvement:${req.params.mouvementId}`);
    if (!mouvementData) {
      res.status(404).json({ error: 'Mouvement not found' });
      return;
    }

    const mouvement: MouvementBancaire = JSON.parse(mouvementData);

    // Get all factures
    const factureIds = await redis.smembers('facture:ids');
    const factures: Facture[] = (
      await Promise.all(
        factureIds.map(async (id) => {
          const data = await redis.get(`facture:${id}`);
          return data ? JSON.parse(data) : null;
        })
      )
    ).filter(Boolean);

    if (factures.length === 0) {
      res.status(400).json({ error: 'No factures available for rapprochement' });
      return;
    }

    const result = await performRapprochement(mouvement, factures);

    const rapprochement: Rapprochement = {
      id: uuidv4(),
      mouvementId: mouvement.id,
      factureIds: result.matchedFactureIds,
      montantMouvement: mouvement.montant,
      montantFactures: result.montantFactures,
      ecart: result.ecart,
      status: result.status,
      aiExplanation: result.explanation,
      createdAt: new Date().toISOString(),
    };

    await redis.set(`rapprochement:${rapprochement.id}`, JSON.stringify(rapprochement));
    await redis.sadd('rapprochement:ids', rapprochement.id);

    res.json({ success: true, rapprochement });
  } catch (err: any) {
    console.error('Rapprochement error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Run rapprochement for all "sortie" mouvements
router.post('/run-all', async (_req: Request, res: Response) => {
  try {
    const mouvementIds = await redis.smembers('mouvement:ids');
    const factureIds = await redis.smembers('facture:ids');

    const factures: Facture[] = (
      await Promise.all(
        factureIds.map(async (id) => {
          const data = await redis.get(`facture:${id}`);
          return data ? JSON.parse(data) : null;
        })
      )
    ).filter(Boolean);

    if (factures.length === 0) {
      res.status(400).json({ error: 'No factures available' });
      return;
    }

    const results: Rapprochement[] = [];

    for (const mid of mouvementIds) {
      const mData = await redis.get(`mouvement:${mid}`);
      if (!mData) continue;
      const mouvement: MouvementBancaire = JSON.parse(mData);
      if (mouvement.type_mouvement !== 'sortie') continue;

      const result = await performRapprochement(mouvement, factures);

      const rapprochement: Rapprochement = {
        id: uuidv4(),
        mouvementId: mouvement.id,
        factureIds: result.matchedFactureIds,
        montantMouvement: mouvement.montant,
        montantFactures: result.montantFactures,
        ecart: result.ecart,
        status: result.status,
        aiExplanation: result.explanation,
        createdAt: new Date().toISOString(),
      };

      await redis.set(`rapprochement:${rapprochement.id}`, JSON.stringify(rapprochement));
      await redis.sadd('rapprochement:ids', rapprochement.id);
      results.push(rapprochement);
    }

    res.json({ success: true, count: results.length, rapprochements: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all rapprochements
router.get('/', async (_req: Request, res: Response) => {
  try {
    const ids = await redis.smembers('rapprochement:ids');
    const rapprochements = await Promise.all(
      ids.map(async (id) => {
        const data = await redis.get(`rapprochement:${id}`);
        return data ? JSON.parse(data) : null;
      })
    );
    res.json(rapprochements.filter(Boolean));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
