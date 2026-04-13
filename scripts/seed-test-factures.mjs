import { createRequire } from 'module';
import { randomUUID } from 'crypto';
const require = createRequire(import.meta.url);
const Redis = require('ioredis');

const redis = new Redis({ host: '127.0.0.1', port: 6379 });

const factures = [
  // Cas 1 : match exact SA-2 (référence FAC_2026_01 dans le libellé du mouvement)
  { fournisseur: 'FOURNISSEUR A',         reference: 'FAC_2026_01',    montant: 120.00,  date: '2026-04-01', docType: 'facture' },
  // Cas 2 : match fuzzy SA-3 (PREL. ORANGE INTERNET ↔ ORANGE COMMUNICATIONS)
  { fournisseur: 'ORANGE COMMUNICATIONS', reference: 'FAC-ORANGE-01',  montant: 45.99,   date: '2026-04-02', docType: 'facture' },
  // Cas 3 : pas de match (STARBUCKS ne doit pas matcher ADOBE)
  { fournisseur: 'ADOBE SYSTEMS',         reference: 'FAC-ADOBE-01',   montant: 25.00,   date: '2026-04-14', docType: 'facture' },
  // Cas 4 : paiement groupé SA-4 (DURAND 1000 + 500 = 1500)
  { fournisseur: 'DURAND SERVICES',       reference: 'DUR-2026-001',   montant: 1000.00, date: '2026-04-05', docType: 'facture' },
  { fournisseur: 'DURAND SERVICES',       reference: 'DUR-2026-002',   montant: 500.00,  date: '2026-04-06', docType: 'facture' },
  // Cas 6 : frais bancaires SA-4 (TECH_CORP 1000 EUR, mouvement 1005 EUR = +5 EUR frais)
  { fournisseur: 'TECH_CORP GLOBAL',      reference: 'INV-999',        montant: 1000.00, date: '2026-04-10', docType: 'facture' },
];

for (const f of factures) {
  const id = randomUUID();
  const doc = {
    id, type: 'facture', docType: 'facture',
    fileName: `${f.reference}.pdf`, rawText: '',
    ...f,
    createdAt: new Date().toISOString(),
  };
  await redis.set(`document:${id}`, JSON.stringify(doc));
  await redis.sadd('document:ids', id);
  console.log(`  OK : ${f.fournisseur} | ${f.reference} | ${f.montant} EUR`);
}

console.log(`\n${factures.length} factures injectees.`);
await redis.quit();
