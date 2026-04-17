import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import redis from '../services/redis.service';
import { performRapprochement } from '../agents/rapprochement.agent';
import { Facture, MouvementBancaire, Rapprochement } from '../types';

const router = Router();

function statusLabel(status: Rapprochement['status']): string {
  if (status === 'exact') return 'Exact';
  if (status === 'partial') return 'Partiel';
  return 'No match';
}

function money(value: number): string {
  return Number(value || 0).toFixed(2);
}

function sanitizeBusinessText(input: string | undefined | null): string {
  const text = (input || '').trim();
  if (!text) return '-';
  // Hide raw UUID-like technical IDs from business PDF output.
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\b[0-9a-f]{16,}\b/gi, '[id]');
}

function dispositionFromQuery(input: unknown): 'inline' | 'attachment' {
  return input === 'attachment' ? 'attachment' : 'inline';
}

async function buildRapprochementRecapPdf(
  confirmed: Rapprochement[],
  mouvementsById: Map<string, MouvementBancaire>,
  facturesById: Map<string, Facture>
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 45 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const exactCount = confirmed.filter((r) => r.status === 'exact').length;
    const partialCount = confirmed.filter((r) => r.status === 'partial').length;
    const noMatchCount = confirmed.filter((r) => r.status === 'no_match').length;

    doc.fontSize(20).fillColor('#0f172a').text('Recapitulatif des rapprochements confirmes');
    doc.moveDown(0.4);
    doc
      .fontSize(10)
      .fillColor('#475569')
      .text(`Genere le ${new Date().toLocaleString('fr-FR')}`)
      .text(`Total confirmes: ${confirmed.length}`)
      .text(`Exact: ${exactCount} | Partiel: ${partialCount} | No match: ${noMatchCount}`);
    doc.moveDown(0.35);
    doc
      .lineWidth(1)
      .strokeColor('#cbd5e1')
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .stroke();
    doc.moveDown(0.8);

    // Table layout (business-friendly)
    const tableLeft = doc.page.margins.left;
    const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const rowPadding = 8; // equivalent to CSS padding: 8px
    const headerHeight = 28;
    const minRowHeight = 26;

    const columns = [
      { key: 'statut', label: 'Statut', width: 52 },
      { key: 'date', label: 'Date', width: 58 },
      { key: 'mouvement', label: 'Mouvement', width: 90 },
      { key: 'factures', label: 'Facture(s)', width: 90 },
      { key: 'montantMvt', label: 'Montant Mvt', width: 70 },
      { key: 'montantFacture', label: 'Montant Facture', width: 76 },
      { key: 'ecart', label: 'Ecart', width: 52 },
      { key: 'analyse', label: 'Analyse IA', width: 132 },
    ] as const;

    const totalDefinedWidth = columns.reduce((sum, c) => sum + c.width, 0);
    const scale = tableWidth / totalDefinedWidth;
    const scaledCols = columns.map((c) => ({ ...c, width: c.width * scale }));

    function drawHeader(startY: number): number {
      // "border-collapse: collapse" style: contiguous borders + shared lines.
      doc.save();
      doc.rect(tableLeft, startY, tableWidth, headerHeight).fill('#f3f4f6');
      doc.restore();
      doc.lineWidth(0.6).strokeColor('#d1d5db');
      doc.rect(tableLeft, startY, tableWidth, headerHeight).stroke();

      let x = tableLeft;
      scaledCols.forEach((col, i) => {
        if (i > 0) {
          doc.moveTo(x, startY).lineTo(x, startY + headerHeight).stroke('#e5e7eb');
        }
        doc
          .font('Helvetica-Bold')
          .fontSize(8.4)
          .fillColor('#0f172a')
          .text(col.label, x + rowPadding, startY + 8, {
            width: col.width - rowPadding * 2,
            lineBreak: false,
          });
        x += col.width;
      });
      return startY + headerHeight;
    }

    let y = drawHeader(doc.y);

    confirmed.forEach((r, rowIdx) => {
      const mouvement = mouvementsById.get(r.mouvementId);
      const factureRefs = (r.factureIds || [])
        .map((id) => {
          const f = facturesById.get(id);
          return f?.reference || f?.fileName || '';
        })
        .filter(Boolean)
        .join(', ') || '-';

      const cells = {
        statut: statusLabel(r.status),
        date: mouvement?.date || '-',
        mouvement: sanitizeBusinessText(mouvement?.libelle || mouvement?.reference || ''),
        factures: sanitizeBusinessText(factureRefs),
        montantMvt: `${money(r.montantMouvement)} EUR`,
        montantFacture: `${money(r.montantFactures)} EUR`,
        ecart: `${money(r.ecart)} EUR`,
        analyse: sanitizeBusinessText(r.aiExplanation),
      };

      doc.font('Helvetica').fontSize(8.5);
      const heights = scaledCols.map((col) => {
        const value = cells[col.key] || '-';
        const textH = doc.heightOfString(value, {
          width: col.width - rowPadding * 2,
          align: col.key === 'analyse' ? 'left' : 'left',
        });
        return textH + rowPadding * 2;
      });

      const rowHeight = Math.max(minRowHeight, ...heights);
      const bottomY = y + rowHeight;
      const pageBottomLimit = doc.page.height - doc.page.margins.bottom;

      if (bottomY > pageBottomLimit) {
        doc.addPage();
        y = drawHeader(doc.page.margins.top);
      }

      if (rowIdx % 2 === 1) {
        doc.save();
        doc.rect(tableLeft, y, tableWidth, rowHeight).fill('#fafafa');
        doc.restore();
      }

      // Subtle bottom border for each row.
      doc
        .lineWidth(0.5)
        .strokeColor('#e5e7eb')
        .moveTo(tableLeft, y + rowHeight)
        .lineTo(tableLeft + tableWidth, y + rowHeight)
        .stroke();

      // Outer left/right borders + vertical separators (collapsed look).
      doc.lineWidth(0.4).strokeColor('#f1f5f9');
      let x = tableLeft;
      doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke();
      scaledCols.forEach((col, idx) => {
        const value = cells[col.key] || '-';
        const isNumeric = col.key === 'montantMvt' || col.key === 'montantFacture' || col.key === 'ecart';
        doc
          .font(col.key === 'statut' ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(8.5)
          .fillColor(col.key === 'statut' ? '#1e3a8a' : '#111827')
          .text(value, x + rowPadding, y + rowPadding, {
            width: col.width - rowPadding * 2,
            align: isNumeric ? 'right' : 'left',
            // Wrap long AI explanations to avoid horizontal overflow.
            lineBreak: true,
          });
        x += col.width;
        if (idx < scaledCols.length) {
          doc.moveTo(x, y).lineTo(x, y + rowHeight).stroke();
        }
      });

      y += rowHeight;
    });

    doc.end();
  });
}

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

    // Supprimer tout rapprochement existant pour ce mouvement avant d'en créer un nouveau
    const existingIds = await redis.smembers('rapprochement:ids');
    for (const rid of existingIds) {
      const raw = await redis.get(`rapprochement:${rid}`);
      if (!raw) continue;
      const existing = JSON.parse(raw);
      if (existing.mouvementId === mouvement.id) {
        await redis.del(`rapprochement:${rid}`);
        await redis.srem('rapprochement:ids', rid);
      }
    }

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

    // Purger tous les rapprochements existants avant de relancer sur l'ensemble
    const existingRappIds = await redis.smembers('rapprochement:ids');
    if (existingRappIds.length > 0) {
      await redis.del(...existingRappIds.map((id: string) => `rapprochement:${id}`));
      await redis.del('rapprochement:ids');
    }

    const results: Rapprochement[] = [];

    for (const mid of mouvementIds) {
      const mData = await redis.get(`mouvement:${mid}`);
      if (!mData) continue;
      const mouvement: MouvementBancaire = JSON.parse(mData);

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

// Get all mouvement IDs (for progress tracking)
router.get('/mouvement-ids', async (_req: Request, res: Response) => {
  try {
    const mouvementIds = await redis.smembers('mouvement:ids');
    const ids: string[] = [];
    for (const mid of mouvementIds) {
      const mData = await redis.get(`mouvement:${mid}`);
      if (!mData) continue;
      const m = JSON.parse(mData);
      ids.push(m.id);
    }
    res.json({ ids, count: ids.length });
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

router.get('/recap-pdf', async (req: Request, res: Response) => {
  try {
    const ids = await redis.smembers('rapprochement:ids');
    const all = (
      await Promise.all(
        ids.map(async (id: string) => {
          const data = await redis.get(`rapprochement:${id}`);
          return data ? (JSON.parse(data) as Rapprochement) : null;
        })
      )
    ).filter(Boolean) as Rapprochement[];

    const confirmed = all.filter((r) => r.confirmed === true);
    if (confirmed.length === 0) {
      res.status(400).json({ error: 'Aucun rapprochement confirme disponible' });
      return;
    }

    const mouvementIds = Array.from(new Set(confirmed.map((r) => r.mouvementId)));
    const factureIds = Array.from(new Set(confirmed.flatMap((r) => r.factureIds || [])));

    const mouvementsById = new Map<string, MouvementBancaire>();
    const facturesById = new Map<string, Facture>();

    await Promise.all(
      mouvementIds.map(async (id) => {
        const raw = await redis.get(`mouvement:${id}`);
        if (raw) mouvementsById.set(id, JSON.parse(raw) as MouvementBancaire);
      })
    );
    await Promise.all(
      factureIds.map(async (id) => {
        const raw = await redis.get(`document:${id}`);
        if (raw) facturesById.set(id, JSON.parse(raw) as Facture);
      })
    );

    const pdfBuffer = await buildRapprochementRecapPdf(confirmed, mouvementsById, facturesById);
    const disposition = dispositionFromQuery(req.query.disposition);
    const fileName = `rapprochements-recap-${new Date().toISOString().slice(0, 10)}.pdf`;

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length.toString(),
      'Content-Disposition': `${disposition}; filename="${fileName}"`,
    });
    res.send(pdfBuffer);
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

// Unconfirm a rapprochement
router.post('/unconfirm/:id', async (req: Request, res: Response) => {
  try {
    const data = await redis.get(`rapprochement:${req.params.id}`);
    if (!data) { res.status(404).json({ error: 'Rapprochement not found' }); return; }
    const r = JSON.parse(data);
    r.confirmed = false;
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
