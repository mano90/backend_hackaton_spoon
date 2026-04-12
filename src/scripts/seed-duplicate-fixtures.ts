/**
 * Duplicate-fixture seed for API / cluster testing (not for `npm test` unit tests).
 *
 * Populates Redis with controlled `document:*` factures to exercise:
 *   GET  /api/documents/factures/duplicate-groups?maxLlmCalls=0
 *   POST /api/documents/factures/backfill-hashes (optional if hashes are set here)
 *
 * Unit tests for matching rules remain in:
 *   src/utils/facture-matching.self-test.ts  →  npm test
 *
 * Usage:
 *   npx ts-node --transpile-only src/scripts/seed-duplicate-fixtures.ts
 *   npx ts-node --transpile-only src/scripts/seed-duplicate-fixtures.ts --clean-only
 *
 * By default the script removes any previously inserted fixture ids (see DUPLICATE_FIXTURE_SET_KEY)
 * then re-seeds, so you can re-run without stacking duplicates.
 *
 * The server runs this after `seed()` (see `src/index.ts`). The npm CLI remains useful to refresh
 * fixtures without restarting, or with `--clean-only`.
 */

import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import dotenv from 'dotenv';
import redis from '../services/redis.service';
import { persistDocumentHashFromBuffer, unregisterDocumentHash } from '../services/document-hash.service';

dotenv.config();

export const DUPLICATE_FIXTURE_SET_KEY = 'duplicate-fixtures:document-ids';

function nowIso(): string {
  return new Date().toISOString();
}

/** Build a minimal PDF; different `lines` ⇒ different file hash. */
function buildPdfBuffer(lines: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 48, size: 'A4' });
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    let y = 56;
    for (const line of lines) {
      doc.fontSize(10).text(line, 48, y, { width: 500 });
      y += 16;
    }
    doc.end();
  });
}

async function cleanDuplicateFixtures(): Promise<number> {
  const ids = await redis.smembers(DUPLICATE_FIXTURE_SET_KEY);
  let removed = 0;
  for (const id of ids) {
    const data = await redis.get(`document:${id}`);
    if (data) {
      const doc = JSON.parse(data) as Record<string, unknown>;
      const h = doc.contentSha256;
      if (typeof h === 'string') await unregisterDocumentHash(h, id);
    }
    await redis.del(`document:${id}`, `document:${id}:pdf`);
    await redis.srem('document:ids', id);
    removed++;
  }
  await redis.del(DUPLICATE_FIXTURE_SET_KEY);
  return removed;
}

async function saveFactureDocument(doc: Record<string, unknown>, pdfBuf: Buffer): Promise<void> {
  await persistDocumentHashFromBuffer(doc, pdfBuf);
  await redis.set(`document:${doc.id}`, JSON.stringify(doc));
  await redis.set(`document:${doc.id}:pdf`, pdfBuf.toString('base64'));
  await redis.sadd('document:ids', doc.id as string);
  await redis.sadd(DUPLICATE_FIXTURE_SET_KEY, doc.id as string);
}

/** Inserts duplicate-test facture documents (after main `seed()` so data is not wiped). */
export async function seedDuplicateFixtures(): Promise<void> {
  const removed = await cleanDuplicateFixtures();
  if (removed > 0) {
    console.log(`[duplicate-fixtures] Removed ${removed} previous fixture document(s).`);
  }

  // A — Byte-identical PDF (same buffer, two logical uploads)
  const sharedPdf = await buildPdfBuffer([
    'FACTURE FIXTURE A — contenu identique (test hash / byte_identical)',
    'Fournisseur: Fixture Dup Co',
    'Montant TTC: 111.00 EUR',
  ]);
  const idA1 = uuidv4();
  const idA2 = uuidv4();
  await saveFactureDocument(
    {
      id: idA1,
      fileName: 'fixture-dup-email.pdf',
      rawText: 'Fixture A email channel same bytes',
      docType: 'facture',
      type: 'facture',
      montant: 111,
      date: '2026-04-01',
      fournisseur: 'Fixture Dup Co',
      reference: 'FIX-A-HASH',
      createdAt: nowIso(),
    },
    sharedPdf
  );
  await saveFactureDocument(
    {
      id: idA2,
      fileName: 'fixture-dup-paper.pdf',
      rawText: 'Fixture A paper channel same bytes',
      docType: 'facture',
      type: 'facture',
      montant: 999,
      date: '2026-04-02',
      fournisseur: 'Other Supplier',
      reference: 'OTHER-REF',
      createdAt: nowIso(),
    },
    sharedPdf
  );
  console.log(`[duplicate-fixtures] A byte_identical: ${idA1}, ${idA2} (same PDF bytes)`);

  // B — Strict triplet: same normalized supplier + ref + amount, different PDF bytes
  const supplierTriplet = 'Fixture Triplet Strict SAS';
  const pdfB1 = await buildPdfBuffer([
    'FACTURE FIXTURE B — canal email',
    `Fournisseur: ${supplierTriplet}`,
    'Ref: FAC-DUP-99  Montant TTC: 500.00 EUR',
  ]);
  const pdfB2 = await buildPdfBuffer([
    'FACTURE FIXTURE B — canal courrier (PDF différent, même triplet métier)',
    `Fournisseur: ${supplierTriplet}`,
    'Ref: FAC-DUP-99  TTC 500 EUR',
  ]);
  const idB1 = uuidv4();
  const idB2 = uuidv4();
  await saveFactureDocument(
    {
      id: idB1,
      fileName: 'triplet-email.pdf',
      rawText: `${supplierTriplet} FAC-DUP-99 500`,
      docType: 'facture',
      type: 'facture',
      montant: 500,
      date: '2026-04-10',
      fournisseur: supplierTriplet,
      reference: 'FAC-DUP-99',
      createdAt: nowIso(),
    },
    pdfB1
  );
  await saveFactureDocument(
    {
      id: idB2,
      fileName: 'triplet-courrier.pdf',
      rawText: `${supplierTriplet} FAC-DUP-99 500`,
      docType: 'facture',
      type: 'facture',
      montant: 500,
      date: '2026-04-11',
      fournisseur: supplierTriplet,
      reference: 'FAC-DUP-99',
      createdAt: nowIso(),
    },
    pdfB2
  );
  console.log(`[duplicate-fixtures] B strict_triplet: ${idB1}, ${idB2}`);

  // C — Human error: same supplier + ref, adjacent-digit transposition on amount (1245 vs 1254)
  const pdfC1 = await buildPdfBuffer([
    'FACTURE FIXTURE C — montant 1245.00 EUR',
    'Fournisseur: SARL DupTrans',
    'Ref: INV-TRANS-12',
  ]);
  const pdfC2 = await buildPdfBuffer([
    'FACTURE FIXTURE C — montant 1254.00 EUR',
    'Fournisseur: SARL DupTrans',
    'Ref: INV-TRANS-12',
  ]);
  const idC1 = uuidv4();
  const idC2 = uuidv4();
  await saveFactureDocument(
    {
      id: idC1,
      fileName: 'transposition-a.pdf',
      rawText: 'DupTrans INV-TRANS-12 1245',
      docType: 'facture',
      type: 'facture',
      montant: 1245,
      date: '2026-04-15',
      fournisseur: 'SARL DupTrans',
      reference: 'INV-TRANS-12',
      createdAt: nowIso(),
    },
    pdfC1
  );
  await saveFactureDocument(
    {
      id: idC2,
      fileName: 'transposition-b.pdf',
      rawText: 'DupTrans INV-TRANS-12 1254',
      docType: 'facture',
      type: 'facture',
      montant: 1254,
      date: '2026-04-15',
      fournisseur: 'SARL DupTrans',
      reference: 'INV-TRANS-12',
      createdAt: nowIso(),
    },
    pdfC2
  );
  console.log(`[duplicate-fixtures] C human_error_amount: ${idC1}, ${idC2}`);

  console.log('[duplicate-fixtures] Done. Try: GET /api/documents/factures/duplicate-groups?maxLlmCalls=0');
}

async function main(): Promise<void> {
  const cleanOnly = process.argv.includes('--clean-only');
  if (cleanOnly) {
    const n = await cleanDuplicateFixtures();
    console.log(`[duplicate-fixtures] --clean-only: removed ${n} fixture document(s).`);
    process.exit(0);
    return;
  }
  await seedDuplicateFixtures();
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[duplicate-fixtures]', err);
    process.exit(1);
  });
}
