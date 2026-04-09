import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import { MouvementBancaire } from '../types';

const router = Router();

// Create a mouvement (JSON body)
router.post('/', async (req: Request, res: Response) => {
  try {
    const { montant, date, libelle, type_mouvement, reference } = req.body;

    if (montant == null || !date || !libelle || !type_mouvement) {
      res.status(400).json({ error: 'Missing required fields: montant, date, libelle, type_mouvement' });
      return;
    }

    const mouvement: MouvementBancaire = {
      id: uuidv4(),
      montant,
      date,
      libelle,
      type_mouvement,
      reference: reference || '',
      type: 'mouvement',
      createdAt: new Date().toISOString(),
    };

    await redis.set(`mouvement:${mouvement.id}`, JSON.stringify(mouvement));
    await redis.sadd('mouvement:ids', mouvement.id);

    res.json({ success: true, mouvement });
  } catch (err: any) {
    console.error('Mouvement creation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Bulk create mouvements (JSON array)
router.post('/bulk', async (req: Request, res: Response) => {
  try {
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Body must be a non-empty array of mouvements' });
      return;
    }

    const mouvements: MouvementBancaire[] = items.map((m: any) => ({
      id: uuidv4(),
      montant: m.montant || 0,
      date: m.date || '',
      libelle: m.libelle || '',
      type_mouvement: m.type_mouvement || 'sortie',
      reference: m.reference || '',
      type: 'mouvement' as const,
      createdAt: new Date().toISOString(),
    }));

    const pipeline = redis.pipeline();
    for (const mouvement of mouvements) {
      pipeline.set(`mouvement:${mouvement.id}`, JSON.stringify(mouvement));
      pipeline.sadd('mouvement:ids', mouvement.id);
    }
    await pipeline.exec();

    res.json({ success: true, count: mouvements.length, mouvements });
  } catch (err: any) {
    console.error('Mouvement bulk creation error:', err);
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
