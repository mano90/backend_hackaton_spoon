import { Facture, MouvementBancaire, DiscrepancyMatchResult } from './types';
import { detectBankFees } from './frais-bancaires.agent';
import { detectCommercialDiscount } from './escompte.agent';
import { detectGroupedPayment } from './paiement-groupe.agent';
import { detectExchangeRate } from './taux-change.agent';

const PRIORITY: DiscrepancyMatchResult['discrepancyReason'][] = [
  'bank_fees',
  'commercial_discount',
  'grouped_payment',
  'exchange_rate',
];

export async function findAmountDiscrepancyMatch(
  mouvement: MouvementBancaire,
  candidateFactures: Facture[],
  allMouvements: MouvementBancaire[] = []
): Promise<DiscrepancyMatchResult> {
  // Run all sub-agents in parallel
  const [bankFees, commercialDiscount, groupedPayment, exchangeRate] = await Promise.all([
    detectBankFees(mouvement, candidateFactures, allMouvements),
    detectCommercialDiscount(mouvement, candidateFactures),
    Promise.resolve(detectGroupedPayment(mouvement, candidateFactures)), // synchronous
    detectExchangeRate(mouvement, candidateFactures),
  ]);

  const results: Record<DiscrepancyMatchResult['discrepancyReason'], DiscrepancyMatchResult> = {
    bank_fees: bankFees,
    commercial_discount: commercialDiscount,
    grouped_payment: groupedPayment,
    exchange_rate: exchangeRate,
    none: { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: '' },
  };

  // Select by priority: first matched in priority order
  for (const reason of PRIORITY) {
    const candidate = results[reason];
    if (candidate.matched) return candidate;
  }

  // No sub-agent matched
  const explanations = [
    bankFees.explanation,
    commercialDiscount.explanation,
    groupedPayment.explanation,
    exchangeRate.explanation,
  ].filter(Boolean).join(' | ');

  return {
    matched: false,
    matchedFactureIds: [],
    montantFactures: 0,
    ecart: mouvement.montant,
    discrepancyReason: 'none',
    explanation: `Aucun écart justifiable trouvé. ${explanations}`,
  };
}
