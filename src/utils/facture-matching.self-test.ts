/**
 * Self-test for facture-matching utils (run: npx ts-node --transpile-only src/utils/facture-matching.self-test.ts)
 */
import assert from 'assert';
import {
  findDeterministicDuplicate,
  isHumanErrorAmountDuplicate,
  isStrictTriplet,
  normalizeReferenceKey,
} from './facture-matching.utils';

assert.strictEqual(normalizeReferenceKey('F-0045'), normalizeReferenceKey('F-45'));

assert.strictEqual(
  isStrictTriplet(
    { fournisseur: 'ACME SARL', reference: 'FAC-001', montant: 100 },
    { fournisseur: 'acme', reference: 'fac-1', montant: 100 }
  ),
  true
);

assert.strictEqual(
  isHumanErrorAmountDuplicate(
    { fournisseur: 'Fournisseur X', reference: 'INV-12', montant: 1245 },
    { fournisseur: 'Fournisseur X', reference: 'INV-12', montant: 1254 }
  ),
  true
);

const dup = findDeterministicDuplicate(
  { montant: 100, fournisseur: 'Co', reference: 'F-01' },
  [
    {
      id: 'a',
      montant: 100,
      date: '2026-01-01',
      fournisseur: 'Co',
      reference: 'F-1',
      fileName: 'x.pdf',
    },
  ]
);
assert.strictEqual(dup?.duplicateId, 'a');
assert.strictEqual(dup?.matchType, 'strict_triplet');

console.log('facture-matching.self-test: OK');
