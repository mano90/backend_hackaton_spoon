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

    // Get all factures from document collection
    const docIds = await redis.smembers('document:ids');
    const factures: Facture[] = (
      await Promise.all(
        docIds.map(async (id: string) => {
          const data = await redis.get(`document:${id}`);
          if (!data) return null;
          const d = JSON.parse(data);
          return (d.docType === 'facture' || d.type === 'facture') ? d : null;
        })
      )
    ).filter(Boolean);

    if (factures.length === 0) {
      res.status(400).json({ error: 'No factures available for rapprochement' });
      return;
    }

    // Fetch all mouvements for SA-1 duplicate detection
    const allMovIds = await redis.smembers('mouvement:ids');
    const allMouvements: MouvementBancaire[] = (
      await Promise.all(
        allMovIds.map(async (id: string) => {
          const d = await redis.get(`mouvement:${id}`);
          return d ? JSON.parse(d) : null;
        })
      )
    ).filter(Boolean);

    const result = await performRapprochement(mouvement, factures, allMouvements);

    const rapprochement: Rapprochement = {
      id: uuidv4(),
      mouvementId: mouvement.id,
      factureIds: result.matchedFactureIds,
      montantMouvement: mouvement.montant,
      montantFactures: result.montantFactures,
      ecart: result.ecart,
      status: result.status,
      aiExplanation: result.explanation,
      confirmed: false,
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
    const allDocIds = await redis.smembers('document:ids');

    const factures: Facture[] = (
      await Promise.all(
        allDocIds.map(async (id: string) => {
          const data = await redis.get(`document:${id}`);
          if (!data) return null;
          const d = JSON.parse(data);
          return (d.docType === 'facture' || d.type === 'facture') ? d : null;
        })
      )
    ).filter(Boolean);

    if (factures.length === 0) {
      res.status(400).json({ error: 'No factures available' });
      return;
    }

    // Load all mouvements once for SA-1 duplicate detection
    const allMouvements: MouvementBancaire[] = (
      await Promise.all(
        mouvementIds.map(async (id: string) => {
          const d = await redis.get(`mouvement:${id}`);
          return d ? JSON.parse(d) : null;
        })
      )
    ).filter(Boolean);

    const results: Rapprochement[] = [];

    for (const mid of mouvementIds) {
      const mData = await redis.get(`mouvement:${mid}`);
      if (!mData) continue;
      const mouvement: MouvementBancaire = JSON.parse(mData);
      if (mouvement.type_mouvement !== 'sortie') continue;

      const result = await performRapprochement(mouvement, factures, allMouvements);

      const rapprochement: Rapprochement = {
        id: uuidv4(),
        mouvementId: mouvement.id,
        factureIds: result.matchedFactureIds,
        montantMouvement: mouvement.montant,
        montantFactures: result.montantFactures,
        ecart: result.ecart,
        status: result.status,
        aiExplanation: result.explanation,
        confirmed: false,
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

// Get sortie mouvement IDs (for progress tracking)
router.get('/sortie-ids', async (_req: Request, res: Response) => {
  try {
    const mouvementIds = await redis.smembers('mouvement:ids');
    const sortieIds: string[] = [];
    for (const mid of mouvementIds) {
      const mData = await redis.get(`mouvement:${mid}`);
      if (!mData) continue;
      const m = JSON.parse(mData);
      if (m.type_mouvement === 'sortie') sortieIds.push(m.id);
    }
    res.json({ ids: sortieIds, count: sortieIds.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get all rapprochements
router.get('/', async (_req: Request, res: Response) => {
  try {
    const ids = await redis.smembers('rapprochement:ids');
    const rapprochements = await Promise.all(
      ids.map(async (id: string) => {
        const data = await redis.get(`rapprochement:${id}`);
        return data ? JSON.parse(data) : null;
      })
    );
    res.json(rapprochements.filter(Boolean));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Confirm a rapprochement
router.post('/confirm/:id', async (req: Request, res: Response) => {
  try {
    const data = await redis.get(`rapprochement:${req.params.id}`);
    if (!data) { res.status(404).json({ error: 'Rapprochement not found' }); return; }
    const r = JSON.parse(data);
    r.confirmed = true;
    await redis.set(`rapprochement:${r.id}`, JSON.stringify(r));
    res.json({ success: true, rapprochement: r });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reject/delete a rapprochement
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await redis.del(`rapprochement:${req.params.id}`);
    await redis.srem('rapprochement:ids', req.params.id as string);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
