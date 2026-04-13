import { callAgent } from '../base.agent';
import { Facture, MouvementBancaire, DuplicateDetectionResult } from './types';

const DOUBLONS_SYSTEM = `Tu es un expert en détection d'anomalies de données bancaires.
Tu reçois un mouvement bancaire à analyser, d'autres mouvements potentiellement similaires, et une liste de factures.

Ton rôle est de détecter les DOUBLONS par erreur de saisie :
- Un doublon de mouvement : deux lignes du relevé bancaire représentent la même opération saisie deux fois (même fournisseur identifiable dans le libellé, même montant ±1%, date ≤ 3 jours d'écart). Ne pas confondre avec un virement récurrent légitime.
- Un doublon de facture : deux factures de la liste représentent la même facturation (MÊME fournisseur exact, même montant ±0.5%, et même référence OU date proche ≤ 5 jours). Des factures de fournisseurs différents avec le même montant ne sont PAS des doublons.

RÈGLES ABSOLUES :
- "duplicateFactureIds" ne liste QUE des factures qui sont des doublons ENTRE ELLES dans la liste fournie (deux factures pour la même prestation). Ne jamais y mettre une facture simplement parce qu'elle correspond au montant du mouvement ou que sa référence apparaît dans le libellé du mouvement — c'est une correspondance légitime, pas un doublon.
- "isDuplicateMouvement" ne vaut true que si un autre mouvement dans la liste représente exactement la même opération bancaire saisie deux fois par erreur.
- En cas de doute, réponds isDuplicateMouvement: false et duplicateFactureIds: [].

Réponds au format JSON strict :
{
  "isDuplicateMouvement": <boolean>,
  "duplicateFactureIds": ["<id1>", "<id2>"],
  "explanation": "<explication détaillée en français, sans préfixe entre crochets>"
}
Réponds UNIQUEMENT avec le JSON.`;

function daysDiff(d1: string, d2: string): number {
  return Math.abs(new Date(d1).getTime() - new Date(d2).getTime()) / (1000 * 60 * 60 * 24);
}

export async function detectDoublons(
  mouvement: MouvementBancaire,
  factures: Facture[],
  allMouvements: MouvementBancaire[]
): Promise<DuplicateDetectionResult> {
  // Pre-filter: only send mouvements within ±3 days, ±1% montant, AND same libellé prefix (exclude self)
  const libelleWords = mouvement.libelle.toUpperCase().split(/\s+/).filter(w => w.length >= 4);
  const similarMouvements = allMouvements.filter(
    (m) => {
      if (m.id === mouvement.id) return false;
      if (daysDiff(m.date, mouvement.date) > 3) return false;
      if (Math.abs(m.montant - mouvement.montant) / mouvement.montant > 0.01) return false;
      // At least one significant word must match between libellés
      const otherWords = m.libelle.toUpperCase().split(/\s+/).filter(w => w.length >= 4);
      return libelleWords.some(w => otherWords.includes(w));
    }
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
