import { callAgent } from '../base.agent';
import { getConfig } from '../../services/config.service';
import { Facture, MouvementBancaire, DiscrepancyMatchResult } from './types';

const FRAIS_BANCAIRES_SYSTEM = `Tu es un expert en frais et commissions bancaires.
Tu reçois un mouvement bancaire et une ou plusieurs factures dont les libellés semblent correspondre mais avec un léger écart de montant.

Ton rôle est de déterminer si l'écart entre le montant du mouvement et le total des factures peut s'expliquer par des frais ou commissions bancaires.

Fourchettes habituelles de frais bancaires :
- Virement SEPA national : 0€ à 1€
- Virement SEPA européen : 0.50€ à 5€
- Virement international (SWIFT) : 5€ à 50€
- Commission de change : 0.1% à 0.5% du montant
- Frais de tenue de compte : 5€ à 20€/mois
- Frais d'impayé ou rejet : 10€ à 40€
- Commission d'intervention : 8€ à 14€

Analyse également le libellé pour identifier la banque et le type de virement.

Si des historiques de mouvements similaires sont fournis, analyse s'ils présentent des frais récurrents du même ordre.

Réponds au format JSON strict :
{
  "matched": <boolean>,
  "matchedFactureIds": ["<id1>"],
  "montantFactures": <number>,
  "ecart": <number>,
  "discrepancyReason": "bank_fees",
  "explanation": "<explication en français, sans préfixe entre crochets, incluant le type de frais identifié>"
}
Réponds UNIQUEMENT avec le JSON.`;

export async function detectBankFees(
  mouvement: MouvementBancaire,
  candidateFactures: Facture[],
  historicalMouvements: MouvementBancaire[] = []
): Promise<DiscrepancyMatchResult> {
  if (candidateFactures.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Aucune facture candidate.' };
  }

  const { bankFeesMaxEcart } = await getConfig();
  const candidates = candidateFactures.filter(
    (f) => mouvement.montant > f.montant && (mouvement.montant - f.montant) < bankFeesMaxEcart
  );

  if (candidates.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Écart trop important ou sens inverse pour des frais bancaires.' };
  }

  // Historical movements from same approximate period for pattern analysis
  const mouvDate = new Date(mouvement.date);
  const historicalContext = historicalMouvements
    .filter((m) => m.id !== mouvement.id && Math.abs(new Date(m.date).getTime() - mouvDate.getTime()) < 90 * 24 * 60 * 60 * 1000)
    .slice(0, 10)
    .map((m) => `- Libellé: ${m.libelle} | Montant: ${m.montant} | Date: ${m.date}`)
    .join('\n');

  const userMessage = `
MOUVEMENT BANCAIRE :
- Montant: ${mouvement.montant}
- Date: ${mouvement.date}
- Libellé: ${mouvement.libelle}
- Référence: ${mouvement.reference}

FACTURES CANDIDATES (libellé potentiellement correspondant) :
${candidates
  .map(
    (f) =>
      `- ID: ${f.id} | Montant: ${f.montant} | Fournisseur: ${f.fournisseur} | Ref: ${f.reference} | Écart avec mouvement: ${(mouvement.montant - f.montant).toFixed(2)}€`
  )
  .join('\n')}
${
  historicalContext
    ? `\nHISTORIQUE RÉCENT (3 derniers mois) :\n${historicalContext}`
    : ''
}
`;

  const result = await callAgent(FRAIS_BANCAIRES_SYSTEM, userMessage);
  try {
    return JSON.parse(result);
  } catch {
    try {
      return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    } catch {
      return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Erreur analyse frais bancaires.' };
    }
  }
}
