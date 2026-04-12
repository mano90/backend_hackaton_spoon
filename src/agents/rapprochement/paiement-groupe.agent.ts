import { Facture, MouvementBancaire, DiscrepancyMatchResult } from './types';

const MAX_SUBSET_SIZE = 8;
const MAX_FACTURES = 15;
const TOLERANCE = 0.02; // 2%

function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  if (k === 0) { yield []; return; }
  if (arr.length < k) return;
  const [first, ...rest] = arr;
  for (const combo of combinations(rest, k - 1)) yield [first, ...combo];
  yield* combinations(rest, k);
}

function findCombination(
  factures: Facture[],
  targetMontant: number
): Facture[] | null {
  const candidates =
    factures.length > MAX_FACTURES
      ? factures.slice(0, MAX_FACTURES) // already sorted by caller
      : factures;

  const maxK = Math.min(candidates.length, MAX_SUBSET_SIZE);
  for (let k = 1; k <= maxK; k++) {
    for (const combo of combinations(candidates, k)) {
      const sum = combo.reduce((acc, f) => acc + f.montant, 0);
      if (Math.abs(sum - targetMontant) / targetMontant <= TOLERANCE) {
        return combo;
      }
    }
  }
  return null;
}

export function detectGroupedPayment(
  mouvement: MouvementBancaire,
  candidateFactures: Facture[]
): DiscrepancyMatchResult {
  const libelle = mouvement.libelle.toLowerCase();

  // Sort by proximity to mouvement date for smart truncation
  const byDateProximity = [...candidateFactures].sort((a, b) => {
    const da = Math.abs(new Date(a.date).getTime() - new Date(mouvement.date).getTime());
    const db = Math.abs(new Date(b.date).getTime() - new Date(mouvement.date).getTime());
    return da - db;
  });

  // Try supplier-filtered subset first
  const supplierFiltered = byDateProximity.filter(
    (f) => f.fournisseur && libelle.includes(f.fournisseur.toLowerCase())
  );

  let match = supplierFiltered.length >= 2 ? findCombination(supplierFiltered, mouvement.montant) : null;

  // Fallback: try all factures
  if (!match) {
    match = findCombination(byDateProximity, mouvement.montant);
  }

  if (!match) {
    return {
      matched: false,
      matchedFactureIds: [],
      montantFactures: 0,
      ecart: mouvement.montant,
      discrepancyReason: 'none',
      explanation: 'Aucune combinaison de factures ne correspond au montant du mouvement.',
    };
  }

  const montantFactures = match.reduce((acc, f) => acc + f.montant, 0);
  const ecart = mouvement.montant - montantFactures;
  const fournisseur = match[0]?.fournisseur ?? 'inconnu';
  const ids = match.map((f) => f.id);

  return {
    matched: true,
    matchedFactureIds: ids,
    montantFactures,
    ecart,
    discrepancyReason: 'grouped_payment',
    explanation: `Paiement groupé détecté : factures [${ids.join(', ')}] du fournisseur ${fournisseur} totalisant ${montantFactures}€ (écart : ${ecart}€).`,
  };
}
