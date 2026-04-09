import { callAgent } from './base.agent';

const SIMILARITY_SYSTEM = `Tu es un agent specialise dans la detection de doublons de factures.

On te donne une NOUVELLE facture et une liste de factures EXISTANTES.
Tu dois verifier si la nouvelle facture est un doublon ou est tres similaire a une facture existante.

Criteres de similarite:
- Meme fournisseur (ou nom tres proche)
- Meme montant (ou ecart < 2%)
- Meme reference de facture
- Meme date (ou dates tres proches, < 7 jours)
- Contenu du texte brut similaire

Reponds UNIQUEMENT avec un JSON strict:
{
  "hasDuplicate": true/false,
  "duplicateId": "<id de la facture existante la plus similaire ou null>",
  "confidence": <number 0-100 representant le % de certitude>,
  "reason": "<explication courte en francais de pourquoi c'est un doublon ou non>"
}

Si plusieurs factures sont similaires, retourne celle avec le score de confiance le plus eleve.
Si aucune similarite, retourne hasDuplicate: false avec duplicateId: null.`;

interface SimilarityResult {
  hasDuplicate: boolean;
  duplicateId: string | null;
  confidence: number;
  reason: string;
}

export async function checkFactureSimilarity(
  newFacture: { montant: number; date: string; fournisseur: string; reference: string; rawText: string; fileSize: number },
  existingFactures: { id: string; montant: number; date: string; fournisseur: string; reference: string; fileName: string }[]
): Promise<SimilarityResult> {
  if (existingFactures.length === 0) {
    return { hasDuplicate: false, duplicateId: null, confidence: 0, reason: 'Aucune facture existante a comparer.' };
  }

  const userMessage = `NOUVELLE FACTURE:
- Montant TTC: ${newFacture.montant} EUR
- Date: ${newFacture.date}
- Fournisseur: ${newFacture.fournisseur}
- Reference: ${newFacture.reference}
- Taille fichier: ${newFacture.fileSize} octets
- Extrait du texte: ${newFacture.rawText.substring(0, 500)}

FACTURES EXISTANTES:
${existingFactures.map(f => `[ID: ${f.id}] Montant: ${f.montant} EUR | Date: ${f.date} | Fournisseur: ${f.fournisseur} | Reference: ${f.reference} | Fichier: ${f.fileName}`).join('\n')}`;

  const result = await callAgent(SIMILARITY_SYSTEM, userMessage);
  try {
    return JSON.parse(result);
  } catch {
    return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  }
}
