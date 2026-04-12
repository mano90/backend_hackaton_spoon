import { callAgent } from '../base.agent';
import { Facture, MouvementBancaire, DuplicateDetectionResult } from './types';

const DOUBLONS_SYSTEM = `Tu es un expert en détection d'anomalies de données bancaires.
Tu reçois un mouvement bancaire à analyser, d'autres mouvements potentiellement similaires, et une liste de factures.

Ton rôle est de détecter les DOUBLONS par erreur de saisie :
- Un doublon de mouvement : deux lignes du relevé bancaire représentent la même opération saisie deux fois (même fournisseur identifiable dans le libellé, même montant ±1%, date ≤ 3 jours d'écart). Ne pas confondre avec un virement récurrent légitime.
- Un doublon de facture : deux factures représentent la même facturation (même fournisseur, même montant ±0.5%, même référence ou date proche ≤ 5 jours).

Réponds au format JSON strict :
{
  "isDuplicateMouvement": <boolean>,
  "duplicateFactureIds": ["<id1>", "<id2>"],
  "explanation": "<explication détaillée>"
}

- Si aucun doublon trouvé : isDuplicateMouvement: false, duplicateFactureIds: []
- Sois conservateur : en cas de doute, ne signale PAS de doublon
Réponds UNIQUEMENT avec le JSON.`;

function daysDiff(d1: string, d2: string): number {
  return Math.abs(new Date(d1).getTime() - new Date(d2).getTime()) / (1000 * 60 * 60 * 24);
}

export async function detectDoublons(
  mouvement: MouvementBancaire,
  factures: Facture[],
  allMouvements: MouvementBancaire[]
): Promise<DuplicateDetectionResult> {
  // Pre-filter: only send mouvements within ±5 days and ±1% montant (exclude self)
  const similarMouvements = allMouvements.filter(
    (m) =>
      m.id !== mouvement.id &&
      daysDiff(m.date, mouvement.date) <= 5 &&
      Math.abs(m.montant - mouvement.montant) / mouvement.montant <= 0.01
  );

  const userMessage = `
MOUVEMENT À ANALYSER :
- ID: ${mouvement.id}
- Montant: ${mouvement.montant}
- Date: ${mouvement.date}
- Libellé: ${mouvement.libelle}
- Référence: ${mouvement.reference}

MOUVEMENTS SIMILAIRES (même montant ±1%, ±5 jours) :
${
  similarMouvements.length === 0
    ? '(aucun)'
    : similarMouvements
        .map(
          (m) =>
            `- ID: ${m.id} | Montant: ${m.montant} | Date: ${m.date} | Libellé: ${m.libelle} | Ref: ${m.reference}`
        )
        .join('\n')
}

FACTURES DISPONIBLES :
${factures
  .map(
    (f) =>
      `- ID: ${f.id} | Montant: ${f.montant} | Date: ${f.date} | Fournisseur: ${f.fournisseur} | Ref: ${f.reference}`
  )
  .join('\n')}
`;

  const result = await callAgent(DOUBLONS_SYSTEM, userMessage);
  try {
    return JSON.parse(result);
  } catch {
    try {
      return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    } catch {
      return { isDuplicateMouvement: false, duplicateFactureIds: [], explanation: 'Erreur analyse doublons.' };
    }
  }
}
