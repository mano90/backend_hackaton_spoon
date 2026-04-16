import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { callM3API, M3CallOptions } from '../services/m3.service';
import redis from '../services/redis.service';

const router = Router();

/**
 * POST /api/m3/execute
 * Body: {
 *   program: string,       // ex: "CRS610MI"
 *   transaction: string,   // ex: "LstSupplier"
 *   data?: Record<string, string>,  // ex: { "CONO": "1" }
 *   options?: { maxrecs?: number, returncols?: string, method?: "GET"|"POST" }
 * }
 */
router.post('/execute', async (req: Request, res: Response) => {
  const { program, transaction, data = {}, options = {} } = req.body as {
    program?: string;
    transaction?: string;
    data?: Record<string, string>;
    options?: M3CallOptions;
  };

  if (!program || !transaction) {
    res.status(400).json({ error: 'Les champs "program" et "transaction" sont obligatoires.' });
    return;
  }

  try {
    const result = await callM3API(program, transaction, data, options);
    res.json({ success: true, program, transaction, result });
  } catch (err: any) {
    const status = err.response?.status ?? 500;
    const detail = err.response?.data ?? null;
    console.error(`[M3] Erreur ${program}/${transaction}:`, err.message);
    res.status(status).json({
      error: err.message,
      program,
      transaction,
      detail,
    });
  }
});

/**
 * POST /api/m3/import-factures
 * Importe des enregistrements M3 comme factures dans la base de l'app.
 * Body: { records: Record<string, string>[] }
 * Champs M3 utilisés : PUNO (référence), SUNO (fournisseur), NTAM/TOQT (montant), DATE (date)
 */
router.post('/import-factures', async (req: Request, res: Response) => {
  const { records, mapping } = req.body as {
    records?: Record<string, string>[];
    mapping?: Record<string, string>;
  };

  if (!records?.length) {
    res.status(400).json({ error: 'Aucun enregistrement à importer.' });
    return;
  }

  // Helpers de résolution de champ avec fallbacks
  const get = (rec: Record<string, string>, key: string, fallbacks: string[]): string => {
    if (mapping?.[key]) return rec[mapping[key]] ?? '';
    for (const f of fallbacks) { if (rec[f] != null) return rec[f]; }
    return '';
  };

  try {
    const imported: string[] = [];

    for (const rec of records) {
      const id = uuidv4();
      const now = new Date().toISOString();

      const montantRaw = get(rec, 'montant', ['NTAM','IVAM','TOQT','REVV','CUAM']);
      const montant = parseFloat(montantRaw.replace(',', '.')) || 0;

      const dateRaw = get(rec, 'date', ['IVDT','DATE','PUDT','ORDT','LEDT']);
      const date = dateRaw.length === 8
        ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
        : dateRaw;

      const fournisseur = get(rec, 'fournisseur', ['SUNO','SUNM','CONM','SPYN']);
      const reference   = get(rec, 'reference',   ['IVNO','PUNO','ORNO','SINO','DONR']) || id;
      const fileLabel   = get(rec, 'fileName',     ['IVNO','PUNO','ORNO','SINO','YRE1']) || id;

      const facture = {
        id,
        fileName: `M3-${fileLabel}`,
        rawText: JSON.stringify(rec),
        montant,
        date,
        fournisseur,
        reference,
        docType: 'facture',
        type: 'facture',
        source: 'm3',
        createdAt: now,
      };

      await redis.set(`document:${id}`, JSON.stringify(facture));
      await redis.sadd('document:ids', id);
      imported.push(id);
    }

    console.log(`[M3] ${imported.length} facture(s) importée(s) depuis M3`);
    res.json({ success: true, count: imported.length, ids: imported });
  } catch (err: any) {
    console.error('[M3] Erreur import factures:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
