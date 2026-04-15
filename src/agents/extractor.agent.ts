import { callAgent } from './base.agent';

const FACTURE_SYSTEM = `Tu es un agent spécialisé dans l'extraction de données de factures.
Analyse le texte d'une facture PDF et extrais les informations au format JSON strict :
{
  "montant": <number|null — montant total TTC>,
  "montantTTC": <number|null — identique au TTC si distinct>,
  "montantHT": <number|null>,
  "montantTVA": <number|null>,
  "tauxTVA": <number|null — ex. 20 pour 20 %>,
  "date": "<string — YYYY-MM-DD>",
  "fournisseur": "<string — raison sociale>",
  "reference": "<string — numéro de facture>",
  "iban": "<string|null — IBAN du bénéficiaire>",
  "bic": "<string|null>",
  "beneficiaireRIB": "<string|null — titulaire du compte si indiqué>",
  "tvaIntracom": "<string|null — n° TVA intracommunautaire, ex. FR12345678901>",
  "siren": "<string|null — 9 chiffres>",
  "siret": "<string|null — 14 chiffres>",
  "adresseFournisseur": "<string|null — adresse complète si visible>",
  "libellePrestation": "<string|null — description courte de la prestation ou de l'objet>"
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

function parseJsonLoose(result: string): Record<string, unknown> {
  try {
    return JSON.parse(result) as Record<string, unknown>;
  } catch {
    return JSON.parse(result.replace(/```json?\n?/gi, '').replace(/```/g, '').trim()) as Record<string, unknown>;
  }
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function extractFactureData(rawText: string): Promise<Record<string, unknown>> {
  const result = await callAgent(FACTURE_SYSTEM, rawText);
  const raw = parseJsonLoose(result);
  const montantTTC = num(raw.montantTTC ?? raw.montant);
  return {
    ...raw,
    montant: montantTTC ?? num(raw.montant),
    montantHT: num(raw.montantHT),
    montantTVA: num(raw.montantTVA),
    tauxTVA: num(raw.tauxTVA),
    montantTTC,
  };
}

export async function extractMouvementData(rawText: string) {
  const result = await callAgent(MOUVEMENT_SYSTEM, rawText);
  try {
    return JSON.parse(result);
  } catch {
    return JSON.parse(result.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  }
}
