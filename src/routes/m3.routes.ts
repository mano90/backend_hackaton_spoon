import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { callM3API, M3CallOptions } from '../services/m3.service';
import redis from '../services/redis.service';
import { tryCreateDuplicatePending } from '../services/document-ingest.service';
import { emitM3FacturesImportProgress } from '../services/realtime-import.service';

const router = Router();

const PENDING_TTL_SEC = 600;

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

export type M3PendingDuplicatePayload = {
  pendingId: string;
  reference: string;
  pendingDocument: Record<string, unknown>;
  similarity: {
    duplicateId: string;
    confidence: number;
    reason: string;
    existingDocument: Record<string, unknown> | null;
  };
};

/**
 * POST /api/m3/import-factures
 * Importe des enregistrements M3 comme factures dans la base de l'app.
 * Vérification doublons (IA) comme upload-batch PDF ; progression Socket.io `m3-factures:progress`.
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

  const get = (rec: Record<string, string>, key: string, fallbacks: string[]): string => {
    if (mapping?.[key]) return rec[mapping[key]] ?? '';
    for (const f of fallbacks) {
      if (rec[f] != null) return rec[f];
    }
    return '';
  };

  const total = records.length;

  try {
    emitM3FacturesImportProgress({
      phase: 'started',
      message: `Import INFOR — ${total} facture(s) à traiter`,
      percent: 2,
      total,
    });

    const imported: string[] = [];
    const pendingDuplicates: M3PendingDuplicatePayload[] = [];

    let idx = 0;
    for (const rec of records) {
      idx += 1;
      emitM3FacturesImportProgress({
        phase: 'processing',
        message: 'Analyse doublon et enregistrement…',
        percent: Math.min(94, Math.round(((idx - 1) / total) * 90) + 5),
        index: idx,
        total,
      });

      const id = uuidv4();
      const now = new Date().toISOString();

      const montantRaw = get(rec, 'montant', ['NTAM', 'IVAM', 'TOQT', 'REVV', 'CUAM']);
      const montant = parseFloat(montantRaw.replace(',', '.')) || 0;

      const dateRaw = get(rec, 'date', ['IVDT', 'DATE', 'PUDT', 'ORDT', 'LEDT']);
      const date =
        dateRaw.length === 8
          ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`
          : dateRaw;

      const fournisseur = get(rec, 'fournisseur', ['SUNO', 'SUNM', 'CONM', 'SPYN']);
      const reference = get(rec, 'reference', ['IVNO', 'PUNO', 'ORNO', 'SINO', 'DONR']) || id;
      const fileLabel = get(rec, 'fileName', ['IVNO', 'PUNO', 'ORNO', 'SINO', 'YRE1']) || id;

      const facture: Record<string, unknown> = {
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

      const dup = await tryCreateDuplicatePending({ ...facture }, 'facture');
      if (dup) {
        const pendingDoc = dup.pendingDocument as Record<string, unknown>;
        const pendingId = String(pendingDoc.id ?? id);
        await redis.set(`document:pending:${pendingId}`, JSON.stringify(pendingDoc), 'EX', PENDING_TTL_SEC);

        pendingDuplicates.push({
          pendingId,
          reference: String(reference),
          pendingDocument: pendingDoc,
          similarity: dup.similarity,
        });

        emitM3FacturesImportProgress({
          phase: 'processing',
          message: 'Doublon suspect — mise en attente',
          percent: Math.min(94, Math.round((idx / total) * 90) + 5),
          index: idx,
          total,
          reference: String(reference),
          outcome: 'pending_duplicate',
        });
        continue;
      }

      await redis.set(`document:${id}`, JSON.stringify(facture));
      await redis.sadd('document:ids', id);
      imported.push(id);

      emitM3FacturesImportProgress({
        phase: 'processing',
        message: 'Facture enregistrée',
        percent: Math.min(94, Math.round((idx / total) * 90) + 5),
        index: idx,
        total,
        reference: String(reference),
        outcome: 'saved',
      });
    }

    emitM3FacturesImportProgress({
      phase: 'done',
      message: `Terminé — ${imported.length} enregistrée(s), ${pendingDuplicates.length} en attente (doublon)`,
      percent: 100,
      total,
    });

    console.log(
      `[M3] Import INFOR : ${imported.length} facture(s) enregistrée(s), ${pendingDuplicates.length} en attente doublon`
    );

    res.json({
      success: true,
      count: imported.length,
      ids: imported,
      pendingDuplicateCount: pendingDuplicates.length,
      pendingDuplicates: pendingDuplicates.length ? pendingDuplicates : undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[M3] Erreur import factures:', message);
    emitM3FacturesImportProgress({
      phase: 'error',
      message,
      percent: 0,
      total,
    });
    res.status(500).json({ error: message });
  }
});

export default router;
