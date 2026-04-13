import { callAgent } from '../base.agent';
import { Facture, MouvementBancaire, SAMatchResult } from './types';

const MATCH_EXACT_SYSTEM = `Tu es un expert en rapprochement bancaire strict.
Tu reçois un mouvement bancaire et une liste de factures dont les montants sont déjà compatibles (pré-filtrés).

Ton rôle est de trouver une correspondance EXACTE :
1. Le libellé du mouvement doit contenir clairement le nom du fournisseur de la facture (correspondance exacte ou quasi-exacte de chaîne de caractères, pas sémantique).
2. Le montant total des factures sélectionnées doit être STRICTEMENT ÉGAL au montant du mouvement (aucun écart toléré, 0 EUR de différence).

Règles STRICTES :
- Si tu n'es pas certain à 100% de la correspondance du libellé, réponds avec matched: false.
- Si le montant des factures n'est pas strictement égal au montant du mouvement, réponds avec matched: false — même 1 centime d'écart suffit.
- Ne tente PAS de rapprochement sémantique ou approximatif. C'est le rôle d'un autre agent.
- Une ou plusieurs factures peuvent être sélectionnées si leur somme est strictement égale au montant du mouvement.

Réponds au format JSON strict :
{
  "matched": <boolean>,
  "matchedFactureIds": ["<id1>"],
  "montantFactures": <number>,
  "ecart": <number>,
  "explanation": "<explication en français, sans préfixe entre crochets>"
}
Réponds UNIQUEMENT avec le JSON.`;

/** Comparaison stricte en centimes pour éviter les erreurs d'arrondi flottant. */
function centsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

function getExactCandidates(mouvement: MouvementBancaire, factures: Facture[]): Facture[] {
  const singles = factures.filter((f) => centsEqual(f.montant, mouvement.montant));
  if (singles.length > 0) return singles;

  const pairs: Facture[] = [];
  for (let i = 0; i < factures.length; i++) {
    for (let j = i + 1; j < factures.length; j++) {
      if (centsEqual(factures[i].montant + factures[j].montant, mouvement.montant)) {
        if (!pairs.includes(factures[i])) pairs.push(factures[i]);
        if (!pairs.includes(factures[j])) pairs.push(factures[j]);
      }
    }
  }
  return pairs;
}

export async function findExactMatch(
  mouvement: MouvementBancaire,
  candidateFactures: Facture[]
): Promise<SAMatchResult> {
  if (candidateFactures.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, explanation: 'Aucune facture candidate.' };
  }

  const exactCandidates = getExactCandidates(mouvement, candidateFactures);
  if (exactCandidates.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, explanation: 'Aucune facture avec montant strictement égal au mouvement.' };
  }

  const userMessage = `
MOUVEMENT BANCAIRE :
- Montant: ${mouvement.montant}
- Date: ${mouvement.date}
- Libellé: ${mouvement.libelle}
- Référence: ${mouvement.reference}

FACTURES AVEC MONTANT STRICTEMENT ÉGAL :
${exactCandidates
  .map(
    (f) =>
      `- ID: ${f.id} | Montant: ${f.montant} | Date: ${f.date} | Fournisseur: ${f.fournisseur} | Ref: ${f.reference}`
  )
  .join('\n')}
`;

  const result = await callAgent(MATCH_EXACT_SYSTEM, userMessage);
  try {
    return JSON.parse(result);
  } catch {
    try {
      return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    } catch {
      return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, explanation: 'Erreur analyse match exact.' };
    }
  }
}
