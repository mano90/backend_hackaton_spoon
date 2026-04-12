import { callAgent } from './base.agent';
import { v4 as uuidv4 } from 'uuid';

/** Pièces déjà enregistrées, pour regroupement en parcours d’achat */
export type DossierLinkInput = {
  id: string;
  docType: string;
  fournisseur: string;
  reference: string;
  date: string;
};

const DOSSIER_LINK_SYSTEM = `Tu es un agent de rapprochement de pièces comptables pour UN même dossier d'achat (une chaîne : devis → commande → livraison → facture, etc.).

Tu reçois une liste de documents déjà identifiés (id, type, fournisseur, référence, date). Ta mission : les regrouper en dossiers logiques.
- Des pièces du MÊME achat chez le MÊME fournisseur partagent un dossier (ex. bon de commande BC-2024-01 et facture qui cite la même commande ou le même fournisseur).
- Des pièces sans lien (fournisseurs différents, ou rien en commun) → dossiers séparés.
- Un document isolé = un groupe d'un seul élément.

Réponds UNIQUEMENT avec un JSON strict de la forme :
{
  "groups": [
    { "memberIds": ["id1", "id2"], "motif": "court en français" }
  ]
}
Chaque id d'entrée doit apparaître exactement une fois dans un memberIds.`;

function parseJsonLoose(raw: string): { groups?: { memberIds: string[]; motif?: string }[] } {
  const cleaned = raw.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

function normalizeFournisseur(f: string): string {
  return f.trim().toLowerCase().replace(/\s+/g, ' ') || '';
}

/**
 * Regroupement heuristique si le LLM échoue : même fournisseur → un dossier pour le lot.
 */
export function linkDossiersHeuristic(docs: DossierLinkInput[]): Map<string, string> {
  const idToScenario = new Map<string, string>();
  const bySupplier = new Map<string, DossierLinkInput[]>();
  for (const d of docs) {
    const key = normalizeFournisseur(d.fournisseur) || `_empty_${d.id}`;
    if (!bySupplier.has(key)) bySupplier.set(key, []);
    bySupplier.get(key)!.push(d);
  }
  for (const [, group] of bySupplier) {
    const sid = uuidv4();
    for (const d of group) idToScenario.set(d.id, sid);
  }
  return idToScenario;
}

/**
 * Assigne un scenarioId (dossier) par groupe. Retourne Map documentId → scenarioId.
 */
export async function linkDocumentsIntoDossiers(docs: DossierLinkInput[]): Promise<Map<string, string>> {
  if (docs.length === 0) return new Map();
  if (docs.length === 1) {
    const m = new Map<string, string>();
    m.set(docs[0].id, uuidv4());
    return m;
  }

  const payload = JSON.stringify(
    docs.map((d) => ({
      id: d.id,
      type: d.docType,
      fournisseur: d.fournisseur,
      reference: d.reference,
      date: d.date,
    })),
    null,
    0
  );

  try {
    const raw = await callAgent(DOSSIER_LINK_SYSTEM, `Documents à regrouper :\n${payload}`);
    let parsed: { groups?: { memberIds: string[]; motif?: string }[] };
    try {
      parsed = parseJsonLoose(raw);
    } catch {
      return linkDossiersHeuristic(docs);
    }
    const groups = parsed.groups;
    if (!Array.isArray(groups) || groups.length === 0) {
      return linkDossiersHeuristic(docs);
    }

    const seen = new Set<string>();
    const idToScenario = new Map<string, string>();

    for (const g of groups) {
      const members = Array.isArray(g.memberIds) ? g.memberIds : [];
      const sid = uuidv4();
      for (const mid of members) {
        if (typeof mid !== 'string' || seen.has(mid)) continue;
        if (!docs.some((d) => d.id === mid)) continue;
        seen.add(mid);
        idToScenario.set(mid, sid);
      }
    }

    for (const d of docs) {
      if (!idToScenario.has(d.id)) {
        idToScenario.set(d.id, uuidv4());
      }
    }
    return idToScenario;
  } catch (e) {
    console.warn('[dossier-link] LLM grouping failed, using heuristic:', e);
    return linkDossiersHeuristic(docs);
  }
}
