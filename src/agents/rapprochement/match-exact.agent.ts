import { callAgent } from '../base.agent';
import { Facture, MouvementBancaire, SAMatchResult } from './types';

const MATCH_EXACT_SYSTEM = `Tu es un expert en rapprochement bancaire strict.
Tu reçois un mouvement bancaire et une liste de factures.

Ton rôle est de trouver une correspondance EXACTE :
1. Le libellé du mouvement doit contenir clairement le nom du fournisseur de la facture (correspondance exacte ou quasi-exacte de chaîne de caractères, pas sémantique).
2. Le montant total des factures sélectionnées doit être égal au montant du mouvement avec un écart inférieur à 1%.

Règles STRICTES :
- Si tu n'es pas certain à 100% de la correspondance du libellé, réponds avec matched: false.
- Ne tente PAS de rapprochement sémantique ou approximatif. C'est le rôle d'un autre agent.
- Une ou plusieurs factures peuvent être sélectionnées si leur somme correspond.

Réponds au format JSON strict :
{
  "matched": <boolean>,
  "matchedFactureIds": ["<id1>"],
  "montantFactures": <number>,
  "ecart": <number>,
  "explanation": "<explication>"
}
Réponds UNIQUEMENT avec le JSON.`;

export async function findExactMatch(
  mouvement: MouvementBancaire,
  candidateFactures: Facture[]
): Promise<SAMatchResult> {
  if (candidateFactures.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, explanation: 'Aucune facture candidate.' };
  }

  const userMessage = `
MOUVEMENT BANCAIRE :
- Montant: ${mouvement.montant}
- Date: ${mouvement.date}
- Libellé: ${mouvement.libelle}
- Référence: ${mouvement.reference}

FACTURES CANDIDATES :
${candidateFactures
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
