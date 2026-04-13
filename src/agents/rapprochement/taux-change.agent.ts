import { callAgent } from '../base.agent';
import { getConfig } from '../../services/config.service';
import { Facture, MouvementBancaire, DiscrepancyMatchResult } from './types';

const TAUX_CHANGE_SYSTEM = `Tu es un expert en opérations de change et transactions internationales.
Tu reçois un mouvement bancaire et une ou plusieurs factures avec un écart de montant.

Ton rôle est de déterminer en UNE SEULE analyse :
1. Y a-t-il des indicateurs de devise étrangère dans le libellé ou la référence du mouvement ?
   (Cherche : codes de devises USD, GBP, CHF, JPY, CAD, AUD, SEK, NOK, DKK, etc.,
    mots-clés : SWIFT, FOREX, DEVISES, CHANGE, FX, noms de pays étrangers, banques étrangères)
2. Si oui : identifie la devise étrangère et estime le taux de change à la date du mouvement.
3. Vérifie si : montant_facture × taux_estimé ≈ montant_mouvement (tolérance 5%)

Si aucun indicateur de devise étrangère n'est trouvé, réponds IMMÉDIATEMENT avec matched: false.

Réponds au format JSON strict :
{
  "matched": <boolean>,
  "matchedFactureIds": ["<id1>"],
  "montantFactures": <number>,
  "ecart": <number>,
  "discrepancyReason": "exchange_rate",
  "explanation": "<explication en français, sans préfixe entre crochets, incluant la devise détectée, le taux estimé, et le calcul>"
}
Réponds UNIQUEMENT avec le JSON.`;

export async function detectExchangeRate(
  mouvement: MouvementBancaire,
  candidateFactures: Facture[]
): Promise<DiscrepancyMatchResult> {
  if (candidateFactures.length === 0) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Aucune facture candidate.' };
  }

  const foreignIndicators = /\b(USD|GBP|CHF|JPY|CAD|AUD|SEK|NOK|DKK|SWIFT|FOREX|DEVISES?|CHANGE|FX)\b/i;
  const hasIndicator = foreignIndicators.test(mouvement.libelle) || foreignIndicators.test(mouvement.reference);

  if (!hasIndicator) {
    return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Aucun indicateur de devise étrangère dans le libellé ou la référence.' };
  }

  const { exchangeRateTolerance } = await getConfig();

  const userMessage = `
MOUVEMENT BANCAIRE :
- Montant: ${mouvement.montant} (devise locale, probablement EUR)
- Date: ${mouvement.date}
- Libellé: ${mouvement.libelle}
- Référence: ${mouvement.reference}

FACTURES CANDIDATES :
${candidateFactures
  .map(
    (f) =>
      `- ID: ${f.id} | Montant: ${f.montant} | Fournisseur: ${f.fournisseur} | Ref: ${f.reference} | Date: ${f.date} | Ratio (mouvement/facture): ${(mouvement.montant / f.montant).toFixed(4)}`
  )
  .join('\n')}

Tolérance acceptée pour le taux de change : ±${exchangeRateTolerance.toFixed(0)}%
`;

  const result = await callAgent(TAUX_CHANGE_SYSTEM, userMessage);
  try {
    return JSON.parse(result);
  } catch {
    try {
      return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    } catch {
      return { matched: false, matchedFactureIds: [], montantFactures: 0, ecart: mouvement.montant, discrepancyReason: 'none', explanation: 'Erreur analyse taux de change.' };
    }
  }
}
