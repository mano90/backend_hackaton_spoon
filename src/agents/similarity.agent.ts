import { callAgent } from './base.agent';
import {
  filterCandidatesForLlm,
  findDeterministicDuplicate,
  type ExistingFactureLite,
} from '../utils/facture-matching.utils';
import { findDuplicateDocumentIdByHash, sha256Buffer } from '../services/document-hash.service';

const SIMILARITY_SYSTEM = `Tu es un agent specialise dans la detection de doublons de factures.

On te donne une NOUVELLE facture et une liste REDUITE de factures EXISTANTES (deja pre-filtrees comme candidats possibles).
Tu dois verifier si la nouvelle facture est un doublon ou tres similaire a une facture existante.

Cas particulier — doublon multi-canal : la meme facture peut avoir ete recue par email (PDF joint) et par courrier papier,
ou saisie deux fois avec un nom de fichier ou un libelle legerement different ; le contenu facture (fournisseur, montant, reference) reste le meme ou tres proche.

Criteres:
- Meme fournisseur (ou nom tres proche)
- Meme montant ou ecart < 2%
- Meme reference de facture ou references proches
- Dates coherentes (proches, < 7 jours)
- Texte brut similaire

Reponds UNIQUEMENT avec un JSON strict:
{
  "hasDuplicate": true/false,
  "duplicateId": "<id de la facture existante la plus similaire ou null>",
  "confidence": <number 0-100>,
  "reason": "<explication courte en francais>",
  "matchType": "multi_channel" | "none"
}

Si c'est un doublon multi-canal (email vs papier, libelles differents, meme facture), utilise matchType "multi_channel".
Si aucune similarite, hasDuplicate: false, duplicateId: null, matchType: "none".

Si plusieurs factures sont similaires, retourne celle avec la confiance la plus elevee.`;

export type MatchLayer = 'hash' | 'rules' | 'llm';

export type SimilarityMatchType =
  | 'byte_identical'
  | 'strict_triplet'
  | 'human_error_amount'
  | 'multi_channel'
  | 'none';

export interface SimilarityResult {
  hasDuplicate: boolean;
  duplicateId: string | null;
  confidence: number;
  reason: string;
  matchLayer?: MatchLayer;
  matchType?: SimilarityMatchType;
  contentSha256?: string;
}

function parseAgentJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const cleaned = raw.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  }
}

/** LLM-only similarity (candidats deja filtres). */
export async function checkFactureSimilarity(
  newFacture: {
    montant: number;
    date: string;
    fournisseur: string;
    reference: string;
    rawText: string;
    fileSize: number;
  },
  existingFactures: ExistingFactureLite[]
): Promise<SimilarityResult> {
  if (existingFactures.length === 0) {
    return {
      hasDuplicate: false,
      duplicateId: null,
      confidence: 0,
      reason: 'Aucune facture existante a comparer.',
      matchLayer: 'llm',
      matchType: 'none',
    };
  }

  const userMessage = `NOUVELLE FACTURE:
- Montant TTC: ${newFacture.montant} EUR
- Date: ${newFacture.date}
- Fournisseur: ${newFacture.fournisseur}
- Reference: ${newFacture.reference}
- Taille fichier: ${newFacture.fileSize} octets
- Extrait du texte: ${newFacture.rawText.substring(0, 500)}

FACTURES EXISTANTES (candidats):
${existingFactures.map((f) => `[ID: ${f.id}] Montant: ${f.montant} EUR | Date: ${f.date} | Fournisseur: ${f.fournisseur} | Reference: ${f.reference} | Fichier: ${f.fileName}`).join('\n')}`;

  const result = await callAgent(SIMILARITY_SYSTEM, userMessage);
  const parsed = parseAgentJson(result);
  const hasDuplicate = Boolean(parsed.hasDuplicate);
  const duplicateId = (parsed.duplicateId as string) || null;
  const confidence = Number(parsed.confidence) || 0;
  const reason = String(parsed.reason || '');
  return {
    hasDuplicate,
    duplicateId: duplicateId || null,
    confidence,
    reason,
    matchLayer: 'llm',
    matchType: hasDuplicate ? 'multi_channel' : 'none',
  };
}

/**
 * Pipeline : hash fichier → regles deterministes → LLM sur candidats filtres.
 */
export async function resolveFactureDuplicate(
  buffer: Buffer,
  newFacture: {
    id: string;
    montant: number;
    date: string;
    fournisseur: string;
    reference: string;
    rawText: string;
    fileName: string;
  },
  existingFactures: ExistingFactureLite[]
): Promise<SimilarityResult> {
  const contentSha256 = sha256Buffer(buffer);

  const hashDupId = await findDuplicateDocumentIdByHash(contentSha256);
  if (hashDupId) {
    return {
      hasDuplicate: true,
      duplicateId: hashDupId,
      confidence: 100,
      reason: 'Fichier PDF identique (empreinte SHA-256 identique a un document deja enregistre).',
      matchLayer: 'hash',
      matchType: 'byte_identical',
      contentSha256,
    };
  }

  if (existingFactures.length === 0) {
    return {
      hasDuplicate: false,
      duplicateId: null,
      confidence: 0,
      reason: 'Aucune facture existante a comparer.',
      matchType: 'none',
      contentSha256,
    };
  }

  const deterministic = findDeterministicDuplicate(
    {
      montant: newFacture.montant,
      fournisseur: newFacture.fournisseur,
      reference: newFacture.reference,
    },
    existingFactures
  );

  if (deterministic) {
    return {
      hasDuplicate: true,
      duplicateId: deterministic.duplicateId,
      confidence: deterministic.confidence,
      reason: deterministic.reason,
      matchLayer: 'rules',
      matchType: deterministic.matchType,
      contentSha256,
    };
  }

  const candidates = filterCandidatesForLlm(
    {
      montant: newFacture.montant,
      date: newFacture.date,
      fournisseur: newFacture.fournisseur,
      reference: newFacture.reference,
      rawText: newFacture.rawText,
    },
    existingFactures
  );

  const llm = await checkFactureSimilarity(
    {
      montant: newFacture.montant,
      date: newFacture.date,
      fournisseur: newFacture.fournisseur,
      reference: newFacture.reference,
      rawText: newFacture.rawText,
      fileSize: buffer.length,
    },
    candidates
  );

  return {
    ...llm,
    contentSha256,
  };
}
