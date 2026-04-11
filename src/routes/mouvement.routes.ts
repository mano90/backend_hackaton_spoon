import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import { MouvementBancaire } from '../types';
import { parseMouvementsCsv } from '../services/csv-mouvements.service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * Import CSV (relevé / export) : détection ; ou , colonnes date, montant, libellé…
 * Doit être déclaré avant GET /:id
 */
router.post('/import-csv', upload.single('file'), async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Fichier manquant (champ file, CSV UTF-8)' });
      return;
    }
    const name = (req.file.originalname || '').toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
      res.status(400).json({ error: 'Extension attendue : .csv ou .txt' });
      return;
    }

    const { rows, errors, headers } = parseMouvementsCsv(req.file.buffer);
    if (!rows.length) {
      res.status(400).json({
        error: 'Aucun mouvement valide',
        parseErrors: errors,
        headers,
      });
      return;
    }

    const mouvements: MouvementBancaire[] = rows.map((r) => ({
      id: uuidv4(),
      montant: r.montant,
      date: r.date,
      libelle: r.libelle,
      type_mouvement: r.type_mouvement,
      reference: r.reference,
      type: 'mouvement',
      createdAt: new Date().toISOString(),
    }));

    const pipeline = redis.pipeline();
    for (const m of mouvements) {
      pipeline.set(`mouvement:${m.id}`, JSON.stringify(m));
      pipeline.sadd('mouvement:ids', m.id);
    }
    await pipeline.exec();

    res.json({
      success: true,
      count: mouvements.length,
      mouvements,
      warnings: errors.length ? errors : undefined,
      headersDetected: headers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('CSV import error:', err);
    res.status(500).json({ error: message });
  }
});

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
      ids.map(async (id: string) => {
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
