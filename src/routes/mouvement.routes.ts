import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import redis from '../services/redis.service';
import { MouvementBancaire } from '../types';
import { parseMouvementsCsv } from '../services/csv-mouvements.service';
import { emitImportProgress } from '../services/realtime-import.service';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function getImportSocketId(req: Request): string | undefined {
  const h = req.headers['x-import-socket-id'];
  const fromHeader = typeof h === 'string' ? h.trim() : Array.isArray(h) ? h[0]?.trim() : '';
  const b = req.body as { socketId?: string } | undefined;
  const fromBody = typeof b?.socketId === 'string' ? b.socketId.trim() : '';
  return fromHeader || fromBody || undefined;
}

const REDIS_CHUNK = 120;

/**
 * Import CSV (relevé / export) : détection ; ou , colonnes date, montant, libellé…
 * Progression temps réel : header `x-import-socket-id` ou champ form `socketId` (Socket.io).
 */
router.post('/import-csv', upload.single('file'), async (req: Request, res: Response) => {
  const sid = getImportSocketId(req);
  try {
    if (!req.file) {
      emitImportProgress(sid, { phase: 'error', message: 'Fichier manquant', percent: 0 });
      res.status(400).json({ error: 'Fichier manquant (champ file, CSV UTF-8)' });
      return;
    }
    const name = (req.file.originalname || '').toLowerCase();
    if (!name.endsWith('.csv') && !name.endsWith('.txt')) {
      emitImportProgress(sid, { phase: 'error', message: 'Extension invalide', percent: 0 });
      res.status(400).json({ error: 'Extension attendue : .csv ou .txt' });
      return;
    }

    emitImportProgress(sid, { phase: 'reading', message: 'Lecture et analyse du CSV…', percent: 8 });

    const { rows, errors, headers } = parseMouvementsCsv(req.file.buffer);

    emitImportProgress(sid, {
      phase: 'parsing',
      message: `${rows.length} ligne(s) valide(s)${errors.length ? ` (${errors.length} ligne(s) ignorée(s))` : ''}`,
      percent: 22,
      current: 0,
      total: rows.length,
    });

    if (!rows.length) {
      emitImportProgress(sid, { phase: 'error', message: 'Aucun mouvement valide', percent: 0 });
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

    const total = mouvements.length;
    for (let i = 0; i < total; i += REDIS_CHUNK) {
      const slice = mouvements.slice(i, i + REDIS_CHUNK);
      const pipeline = redis.pipeline();
      for (const m of slice) {
        pipeline.set(`mouvement:${m.id}`, JSON.stringify(m));
        pipeline.sadd('mouvement:ids', m.id);
      }
      await pipeline.exec();
      const current = Math.min(i + slice.length, total);
      const pct = 25 + Math.round((current / total) * 70);
      emitImportProgress(sid, {
        phase: 'saving',
        message: `Enregistrement en base… ${current} / ${total}`,
        percent: Math.min(pct, 98),
        current,
        total,
      });
    }

    emitImportProgress(sid, {
      phase: 'done',
      message: `Import terminé : ${total} mouvement(s)`,
      percent: 100,
      current: total,
      total,
    });

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
    emitImportProgress(sid, { phase: 'error', message, percent: 0 });
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

// Bulk create mouvements (JSON array) — progression : header `x-import-socket-id`
router.post('/bulk', async (req: Request, res: Response) => {
  const sid = getImportSocketId(req);
  try {
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      emitImportProgress(sid, { phase: 'error', message: 'Tableau vide ou invalide', percent: 0 });
      res.status(400).json({ error: 'Body must be a non-empty array of mouvements' });
      return;
    }

    emitImportProgress(sid, {
      phase: 'parsing',
      message: `Préparation de ${items.length} mouvement(s)…`,
      percent: 15,
      current: 0,
      total: items.length,
    });

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

    const total = mouvements.length;
    for (let i = 0; i < total; i += REDIS_CHUNK) {
      const slice = mouvements.slice(i, i + REDIS_CHUNK);
      const pipeline = redis.pipeline();
      for (const mouvement of slice) {
        pipeline.set(`mouvement:${mouvement.id}`, JSON.stringify(mouvement));
        pipeline.sadd('mouvement:ids', mouvement.id);
      }
      await pipeline.exec();
      const current = Math.min(i + slice.length, total);
      const pct = 20 + Math.round((current / total) * 75);
      emitImportProgress(sid, {
        phase: 'saving',
        message: `Enregistrement… ${current} / ${total}`,
        percent: Math.min(pct, 99),
        current,
        total,
      });
    }

    emitImportProgress(sid, {
      phase: 'done',
      message: `Bulk terminé : ${total} mouvement(s)`,
      percent: 100,
      current: total,
      total,
    });

    res.json({ success: true, count: mouvements.length, mouvements });
  } catch (err: any) {
    console.error('Mouvement bulk creation error:', err);
    emitImportProgress(sid, { phase: 'error', message: err.message || String(err), percent: 0 });
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
