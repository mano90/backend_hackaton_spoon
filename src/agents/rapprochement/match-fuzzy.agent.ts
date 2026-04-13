import { callAgent } from '../base.agent';
import { Facture, MouvementBancaire, SAMatchResult } from './types';

const MATCH_FUZZY_SYSTEM = `Tu es un expert en rapprochement bancaire sémantique.
Tu reçois un mouvement bancaire et une liste de factures dont le montant est compatible.

Ton rôle est de trouver une correspondance où :
- Le MONTANT est STRICTEMENT ÉGAL — déjà vérifié, toutes les factures proposées ont un montant strictement égal au mouvement (arrondi flottant 0.01 EUR près).
- Le LIBELLÉ du mouvement et le nom du fournisseur de la facture sont sémantiquement proches malgré des différences de surface.

Exemples de correspondances sémantiques valides :
- "VIR SEPA ORANGE S.A" → fournisseur "Orange SA"
- "DUPONT FRERES SARL" → fournisseur "Dupont & Frères"
- "AMAZON EU SARL LU" → fournisseur "Amazon"
- "PMT BOUYGUES TELECOM" → fournisseur "Bouygues Télécom"
- Abréviations, acronymes, noms commerciaux vs légaux, fautes de frappe mineures.

Règles :
- Si les libellés sont sémantiquement équivalents ET le montant compatible, réponds avec matched: true.
- Si tu doutes, préfère matched: false (un autre agent traitera les cas avec écart de montant).

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

function getMontantCompatibles(mouvement: MouvementBancaire, factures: Facture[]): Facture[] {
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

export async function findFuzzyLabelMatch(
  mouvement: MouvementBancaire,
  candidateFactures: Facture[]
): Promise<SAMatchResult> {
  if (candidateFactures.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, explanation: 'Aucune facture candidate.' };
  }

  const amountCompatible = getMontantCompatibles(mouvement, candidateFactures);
  if (amountCompatible.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, explanation: 'Aucune facture avec montant compatible pour comparaison sémantique.' };
  }

  const userMessage = `
MOUVEMENT BANCAIRE :
- Montant: ${mouvement.montant}
- Date: ${mouvement.date}
- Libellé: ${mouvement.libelle}
- Référence: ${mouvement.reference}

FACTURES AVEC MONTANT COMPATIBLE (écart < 1%) :
${amountCompatible
  .map(
    (f) =>
      `- ID: ${f.id} | Montant: ${f.montant} | Date: ${f.date} | Fournisseur: ${f.fournisseur} | Ref: ${f.reference}`
  )
  .join('\n')}
`;

  const result = await callAgent(MATCH_FUZZY_SYSTEM, userMessage);
  try {
    return JSON.parse(result);
  } catch {
    try {
      return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    } catch {
      return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, explanation: 'Erreur analyse match fuzzy.' };
    }
  }
}
