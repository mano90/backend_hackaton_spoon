import { callAgent } from '../base.agent';
import { queryData } from '../query.agent';
import { Facture, MouvementBancaire, DiscrepancyMatchResult } from './types';

const ESCOMPTE_SYSTEM = `Tu es un expert en comptabilité fournisseurs et gestion des accords commerciaux.
Tu reçois un mouvement bancaire, une ou plusieurs factures avec un écart de montant, et le résultat d'une recherche documentaire sur d'éventuels accords commerciaux.

Ton rôle est de déterminer si l'écart entre le montant payé (mouvement) et le montant facturé (facture) peut s'expliquer par :
- Un escompte pour paiement anticipé (ex: 2% si paiement sous 10 jours)
- Une remise commerciale négociée
- Un avoir commercial appliqué
- Toute autre forme d'accord de réduction du prix

Analyse le contexte documentaire fourni pour trouver des preuves d'un tel accord.

Réponds au format JSON strict :
{
  "matched": <boolean>,
  "matchedFactureIds": ["<id1>"],
  "montantFactures": <number>,
  "ecart": <number>,
  "discrepancyReason": "commercial_discount",
  "explanation": "<explication incluant le type et taux de remise identifié>"
}
Réponds UNIQUEMENT avec le JSON.`;

export async function detectCommercialDiscount(
  mouvement: MouvementBancaire,
  candidateFactures: Facture[]
): Promise<DiscrepancyMatchResult> {
  if (candidateFactures.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Aucune facture candidate.' };
  }

  // Pre-filter: payment < invoice (discount reduces what's paid)
  const candidates = candidateFactures.filter((f) => mouvement.montant < f.montant);

  if (candidates.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Aucune facture avec montant supérieur au mouvement (sens non cohérent avec un escompte).' };
  }

  // Extract supplier names for the query
  const fournisseurs = [...new Set(candidates.map((f) => f.fournisseur).filter(Boolean))].join(', ');
  const references = candidates.map((f) => f.reference).filter(Boolean).join(', ');

  // Step 1: Query documents for discount agreements
  let contextDocumentaire = '';
  try {
    const queryResult = await queryData(
      `Y a-t-il un accord d'escompte, de remise commerciale ou un avoir avec le(s) fournisseur(s) "${fournisseurs}" concernant la(les) facture(s) référence(s) "${references}" ? Quelles conditions de paiement sont mentionnées ?`
    );
    contextDocumentaire = queryResult.answer;
  } catch {
    contextDocumentaire = 'Impossible de récupérer le contexte documentaire.';
  }

  const userMessage = `
MOUVEMENT BANCAIRE :
- Montant payé: ${mouvement.montant}
- Date: ${mouvement.date}
- Libellé: ${mouvement.libelle}
- Référence: ${mouvement.reference}

FACTURES CANDIDATES :
${candidates
  .map(
    (f) =>
      `- ID: ${f.id} | Montant facturé: ${f.montant} | Écart: ${(f.montant - mouvement.montant).toFixed(2)}€ (${((1 - mouvement.montant / f.montant) * 100).toFixed(1)}%) | Fournisseur: ${f.fournisseur} | Ref: ${f.reference} | Date: ${f.date}`
  )
  .join('\n')}

CONTEXTE DOCUMENTAIRE (accords commerciaux trouvés) :
${contextDocumentaire}
`;

  const result = await callAgent(ESCOMPTE_SYSTEM, userMessage);
  try {
    return JSON.parse(result);
  } catch {
    try {
      return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    } catch {
      return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Erreur analyse escompte commercial.' };
    }
  }
}
