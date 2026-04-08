import { callAgent } from './base.agent';
import { Facture, MouvementBancaire } from '../types';

const RAPPROCHEMENT_SYSTEM = `Tu es un agent expert en rapprochement bancaire.
Tu reçois un mouvement bancaire (sortie d'argent) et une liste de factures.
Ton rôle est de trouver quelles factures correspondent à ce mouvement.

Critères de rapprochement:
1. Le montant du mouvement doit correspondre au total des factures (avec tolérance de 1%)
2. Les dates doivent être cohérentes (facture avant ou le même jour que le mouvement)
3. Le libellé du mouvement peut contenir le nom du fournisseur

Réponds au format JSON strict:
{
  "matchedFactureIds": ["<id1>", "<id2>"],
  "montantFactures": <number>,
  "ecart": <number - différence entre mouvement et total factures>,
  "status": "<'exact' | 'partial' | 'no_match'>",
  "explanation": "<string - explication détaillée du rapprochement>"
}

- "exact": les montants correspondent parfaitement (écart < 1%)
- "partial": correspondance partielle (certaines factures trouvées mais écart > 1%)
- "no_match": aucune facture ne correspond

Réponds UNIQUEMENT avec le JSON.`;

export async function performRapprochement(
  mouvement: MouvementBancaire,
  factures: Facture[]
): Promise<{
  matchedFactureIds: string[];
  montantFactures: number;
  ecart: number;
  status: 'exact' | 'partial' | 'no_match';
  explanation: string;
}> {
  const userMessage = `
MOUVEMENT BANCAIRE:
- Montant: ${mouvement.montant}
- Date: ${mouvement.date}
- Libellé: ${mouvement.libelle}
- Référence: ${mouvement.reference}

FACTURES DISPONIBLES:
${factures.map((f) => `- ID: ${f.id} | Montant: ${f.montant} | Date: ${f.date} | Fournisseur: ${f.fournisseur} | Ref: ${f.reference}`).join('\n')}
`;

  const result = await callAgent(RAPPROCHEMENT_SYSTEM, userMessage);
  try {
    return JSON.parse(result);
  } catch {
    return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  }
}
