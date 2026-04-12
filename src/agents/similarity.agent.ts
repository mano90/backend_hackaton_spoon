import { callAgent } from './base.agent';

function buildSimilaritySystem(docTypeLabel: string): string {
  return `Tu es un agent specialise dans la detection de doublons de documents commerciaux.

Type de document traite : ${docTypeLabel}.
On te donne un NOUVEAU document et une liste de documents EXISTANTS du meme type.
Tu dois verifier si le nouveau document est un doublon ou est tres similaire a un document existant (meme commande / meme piece).

Criteres de similarite:
- Meme fournisseur (ou nom tres proche)
- Meme montant (ou ecart < 2%) si pertinent
- Meme reference (facture, bon de commande, etc.)
- Meme date (ou dates tres proches, < 7 jours)
- Contenu du texte brut similaire

Reponds UNIQUEMENT avec un JSON strict:
{
  "hasDuplicate": true/false,
  "duplicateId": "<id du document existant le plus similaire ou null>",
  "confidence": <number 0-100 representant le % de certitude>,
  "reason": "<explication courte en francais de pourquoi c'est un doublon ou non>"
}

Si plusieurs documents sont similaires, retourne celui avec le score de confiance le plus eleve.
Si aucune similarite, retourne hasDuplicate: false avec duplicateId: null.`;
}

interface SimilarityResult {
  hasDuplicate: boolean;
  duplicateId: string | null;
  confidence: number;
  reason: string;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  facture: 'facture',
  bon_commande: 'bon de commande',
};

export async function checkFactureSimilarity(
  newFacture: { montant: number; date: string; fournisseur: string; reference: string; rawText: string; fileSize: number },
  existingFactures: { id: string; montant: number; date: string; fournisseur: string; reference: string; fileName: string }[],
  docType: string = 'facture'
): Promise<SimilarityResult> {
  if (existingFactures.length === 0) {
    return { hasDuplicate: false, duplicateId: null, confidence: 0, reason: 'Aucun document existant a comparer.' };
  }

  const typeLabel = DOC_TYPE_LABELS[docType] ?? docType;
  const systemPrompt = buildSimilaritySystem(typeLabel);

  const userMessage = `NOUVEAU DOCUMENT (${typeLabel}):
- Montant TTC: ${newFacture.montant} EUR
- Date: ${newFacture.date}
- Fournisseur: ${newFacture.fournisseur}
- Reference: ${newFacture.reference}
- Taille fichier: ${newFacture.fileSize} octets
- Extrait du texte: ${newFacture.rawText.substring(0, 500)}

DOCUMENTS EXISTANTS (${typeLabel}):
${existingFactures.map(f => `[ID: ${f.id}] Montant: ${f.montant} EUR | Date: ${f.date} | Fournisseur: ${f.fournisseur} | Reference: ${f.reference} | Fichier: ${f.fileName}`).join('\n')}`;

  const result = await callAgent(systemPrompt, userMessage);
  try {
    return JSON.parse(result);
  } catch {
    return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  }
}
