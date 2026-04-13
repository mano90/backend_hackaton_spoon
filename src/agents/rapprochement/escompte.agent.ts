import { callAgent } from '../base.agent';
import { getConfig } from '../../services/config.service';
import { queryData } from '../query.agent';
import { Facture, MouvementBancaire, DiscrepancyMatchResult } from './types';

function buildEscompteSystem(discountMaxWithoutProof: number, discountAbsoluteMax: number): string {
  return `Tu es un expert en comptabilité fournisseurs et gestion des accords commerciaux.
Tu reçois un mouvement bancaire, une ou plusieurs factures avec un écart de montant, et le résultat d'une recherche documentaire sur d'éventuels accords commerciaux.

Ton rôle est de déterminer si l'écart entre le montant payé (mouvement) et le montant facturé (facture) peut s'expliquer par :
- Un escompte pour paiement anticipé (taux usuels : 1% à 5%)
- Une remise commerciale négociée (taux usuels : jusqu'à 30% maximum)
- Un avoir commercial appliqué
- Toute autre forme d'accord de réduction du prix documenté

RÈGLES ABSOLUES :
1. Le fournisseur de la facture DOIT être identifiable dans le libellé du mouvement (nom, sigle ou abréviation reconnaissable). Si le libellé ne mentionne pas ce fournisseur, réponds avec matched: false.
2. Un écart supérieur à ${discountAbsoluteMax}% n'est jamais un escompte ou une remise commerciale standard — réponds matched: false.
3. Sans preuve documentaire d'un accord (contexte documentaire non vide et pertinent), ne valide pas un écart supérieur à ${discountMaxWithoutProof}%.

Réponds au format JSON strict :
{
  "matched": <boolean>,
  "matchedFactureIds": ["<id1>"],
  "montantFactures": <number>,
  "ecart": <number>,
  "discrepancyReason": "commercial_discount",
  "explanation": "<explication en français, sans préfixe entre crochets, incluant le type et taux de remise identifié>"
}
Réponds UNIQUEMENT avec le JSON.`;
}

export async function detectCommercialDiscount(
  mouvement: MouvementBancaire,
  candidateFactures: Facture[]
): Promise<DiscrepancyMatchResult> {
  if (candidateFactures.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Aucune facture candidate.' };
  }

  // Pre-filter 1: payment < invoice (discount reduces what's paid)
  const belowInvoice = candidateFactures.filter((f) => mouvement.montant < f.montant);
  if (belowInvoice.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Aucune facture avec montant supérieur au mouvement (sens non cohérent avec un escompte).' };
  }

  // Pre-filter 2: at least one word (≥4 chars) of the fournisseur must appear in the libellé
  const libelleUpper = mouvement.libelle.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const candidates = belowInvoice.filter((f) => {
    if (!f.fournisseur) return false;
    const words = f.fournisseur.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[\s\-&,\.]+/);
    return words.some((w) => w.length >= 4 && libelleUpper.includes(w));
  });

  if (candidates.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Aucun fournisseur candidat identifiable dans le libellé du mouvement.' };
  }

  const { discountMaxWithoutProof, discountAbsoluteMax } = await getConfig();

  // Extract supplier names for the query
  const fournisseurs = [...new Set(candidates.map((f) => f.fournisseur).filter(Boolean))].join(', ');
  const references = candidates.map((f) => f.reference).filter(Boolean).join(', ');

  // Query documents for discount agreements
  let contextDocumentaire = '';
  try {
    const queryResult = await queryData(
      `escompte-agent:${mouvement.id}`,
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

  const system = buildEscompteSystem(discountMaxWithoutProof, discountAbsoluteMax);
  const result = await callAgent(system, userMessage);
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
