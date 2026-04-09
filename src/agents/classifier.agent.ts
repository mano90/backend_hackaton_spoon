import { callAgent } from './base.agent';

const CLASSIFIER_SYSTEM = `Tu es un agent specialise dans la classification de documents commerciaux.

A partir du texte extrait d'un PDF, tu dois determiner le type de document parmi:
- devis : Demande de devis ou proposition de prix
- bon_commande : Bon de commande, confirmation de commande
- bon_livraison : Bon de livraison, bordereau de livraison
- bon_reception : Bon de reception, accuse de reception de marchandise
- facture : Facture, note de frais, avoir
- email : Email, courrier electronique, correspondance

Indices pour chaque type:
- DEVIS: mots cles "devis", "proposition", "offre de prix", "validite", "estimation"
- BON DE COMMANDE: mots cles "bon de commande", "BC", "commande", "date de livraison souhaitee"
- BON DE LIVRAISON: mots cles "bon de livraison", "BL", "livraison", "transporteur", "colis", "expedie"
- BON DE RECEPTION: mots cles "bon de reception", "BR", "reception", "conforme", "quantite recue"
- FACTURE: mots cles "facture", "FAC", "montant TTC", "TVA", "echeance", "reglement"
- EMAIL: mots cles "De:", "A:", "Objet:", "Cordialement", "Bonjour", "@"

Reponds UNIQUEMENT avec un JSON strict:
{
  "docType": "<devis | bon_commande | bon_livraison | bon_reception | facture | email>",
  "confidence": <number 0-100>,
  "reason": "<explication courte en francais de pourquoi ce type>"
}`;

export interface ClassificationResult {
  docType: string;
  confidence: number;
  reason: string;
}

export async function classifyDocument(rawText: string, fileName: string): Promise<ClassificationResult> {
  const userMessage = `Nom du fichier: ${fileName}\n\nTexte extrait du document:\n${rawText.substring(0, 2000)}`;

  const result = await callAgent(CLASSIFIER_SYSTEM, userMessage);
  try {
    return JSON.parse(result);
  } catch {
    return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  }
}
