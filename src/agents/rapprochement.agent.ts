import { Facture, MouvementBancaire } from '../types';
import { detectDoublons } from './rapprochement/doublons.agent';
import { findExactMatch } from './rapprochement/match-exact.agent';
import { findFuzzyLabelMatch } from './rapprochement/match-fuzzy.agent';
import { findAmountDiscrepancyMatch } from './rapprochement/ecart.agent';

export async function performRapprochement(
  mouvement: MouvementBancaire,
  factures: Facture[],
  allMouvements: MouvementBancaire[] = []
): Promise<{
  matchedFactureIds: string[];
  montantFactures: number;
  ecart: number;
  status: 'exact' | 'partial' | 'no_match';
  explanation: string;
}> {
  // === SA-1 : Détection de doublons ===
  const sa1 = await detectDoublons(mouvement, factures, allMouvements);

  if (sa1.isDuplicateMouvement) {
    return {
      matchedFactureIds: [],
      montantFactures: 0,
      ecart: mouvement.montant,
      status: 'no_match',
      explanation: `[SA-1 Doublons] Mouvement identifié comme doublon. ${sa1.explanation}`,
    };
  }

  const excludedFactureIds = new Set(sa1.duplicateFactureIds);
  const remaining = factures.filter((f) => !excludedFactureIds.has(f.id));
  const doublonNote = sa1.duplicateFactureIds.length > 0
    ? `Factures exclues (doublons) : [${sa1.duplicateFactureIds.join(', ')}]. `
    : '';

  // === SA-2 : Match exact (libellé + montant) ===
  const sa2 = await findExactMatch(mouvement, remaining);
  if (sa2.matched) {
    return {
      matchedFactureIds: sa2.matchedFactureIds,
      montantFactures: sa2.montantFactures,
      ecart: sa2.ecart,
      status: 'exact',
      explanation: `${doublonNote}[SA-2 Exact] ${sa2.explanation}`,
    };
  }

  // === SA-3 : Match sémantique (libellé fuzzy + montant exact) ===
  const sa3 = await findFuzzyLabelMatch(mouvement, remaining);
  if (sa3.matched) {
    return {
      matchedFactureIds: sa3.matchedFactureIds,
      montantFactures: sa3.montantFactures,
      ecart: sa3.ecart,
      status: 'exact',
      explanation: `${doublonNote}[SA-3 Fuzzy] ${sa3.explanation}`,
    };
  }

  // === SA-4 : Justification d'écart de montant ===
  const sa4 = await findAmountDiscrepancyMatch(mouvement, remaining, allMouvements);
  if (sa4.matched) {
    return {
      matchedFactureIds: sa4.matchedFactureIds,
      montantFactures: sa4.montantFactures,
      ecart: sa4.ecart,
      status: 'partial',
      explanation: `${doublonNote}[SA-4 ${sa4.discrepancyReason}] ${sa4.explanation}`,
    };
  }

  // === Aucun rapprochement trouvé ===
  const explanationParts = [
    doublonNote,
    `[SA-2] ${sa2.explanation}`,
    `[SA-3] ${sa3.explanation}`,
    `[SA-4] ${sa4.explanation}`,
  ].filter(Boolean);

  return {
    matchedFactureIds: [],
    montantFactures: 0,
    ecart: mouvement.montant,
    status: 'no_match',
    explanation: explanationParts.join(' | '),
  };
}
