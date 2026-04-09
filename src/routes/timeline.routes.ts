import { Router, Request, Response } from 'express';
import redis from '../services/redis.service';

const router = Router();

const ALL_TYPES = ['devis', 'bon_commande', 'bon_livraison', 'bon_reception', 'facture', 'mouvement', 'email'];

// Get full timeline (all documents sorted by date)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const events: any[] = [];

    for (const docType of ALL_TYPES) {
      const ids = await redis.smembers(`${docType}:ids`);
      for (const id of ids) {
        const data = await redis.get(`${docType}:${id}`);
        if (!data) continue;
        const doc = JSON.parse(data);
        events.push({
          id: doc.id,
          type: doc.type || docType,
          date: doc.date,
          reference: doc.reference || doc.subject || doc.libelle || '',
          fournisseur: doc.fournisseur || doc.from || '',
          montant: doc.montant || null,
          scenarioId: doc.scenarioId || null,
          subject: doc.subject || null,
          hasRelation: doc.hasRelation ?? null,
          relationType: doc.relationType || null,
          fileName: doc.fileName || null,
        });
      }
    }

    // Sort by date
    events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get timeline for a specific scenario
router.get('/scenario/:scenarioId', async (req: Request, res: Response) => {
  try {
    const { scenarioId } = req.params;
    const events: any[] = [];

    for (const docType of ALL_TYPES) {
      const ids = await redis.smembers(`${docType}:ids`);
      for (const id of ids) {
        const data = await redis.get(`${docType}:${id}`);
        if (!data) continue;
        const doc = JSON.parse(data);
        if (doc.scenarioId === scenarioId) {
          events.push({
            id: doc.id,
            type: doc.type || docType,
            date: doc.date,
            reference: doc.reference || doc.subject || doc.libelle || '',
            fournisseur: doc.fournisseur || doc.from || '',
            montant: doc.montant || null,
            scenarioId: doc.scenarioId,
            subject: doc.subject || null,
            fileName: doc.fileName || null,
          });
        }
      }
    }

    events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
