import { callAgent } from './base.agent';

const FACTURE_SYSTEM = `Tu es un agent spécialisé dans l'extraction de données de factures.
Analyse le texte d'une facture PDF et extrais les informations suivantes au format JSON strict:
{
  "montant": <number - montant total TTC>,
  "date": "<string - date au format YYYY-MM-DD>",
  "fournisseur": "<string - nom du fournisseur>",
  "reference": "<string - numéro de facture ou référence>"
}
Réponds UNIQUEMENT avec le JSON, sans aucun texte autour. Si une information est manquante, mets null.`;

const MOUVEMENT_SYSTEM = `Tu es un agent spécialisé dans l'extraction de données de relevés bancaires.
Analyse le texte d'un relevé bancaire PDF et extrais TOUS les mouvements sous forme de tableau JSON:
[
  {
    "montant": <number - montant absolu>,
    "date": "<string - date au format YYYY-MM-DD>",
    "libelle": "<string - libellé de l'opération>",
    "type_mouvement": "<string - 'entree' ou 'sortie'>",
    "reference": "<string - référence de l'opération si disponible>"
  }
]
Réponds UNIQUEMENT avec le JSON, sans aucun texte autour. Si une information est manquante, mets null.`;

export async function extractFactureData(rawText: string) {
  const result = await callAgent(FACTURE_SYSTEM, rawText);
  try {
    return JSON.parse(result);
  } catch {
    return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  }
}

export async function extractMouvementData(rawText: string) {
  const result = await callAgent(MOUVEMENT_SYSTEM, rawText);
  try {
    return JSON.parse(result);
  } catch {
    return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  }
}
