import { callAgentWithHistory } from './base.agent';
import redis from '../services/redis.service';
import {
  appendLlmTurns,
  appendTurn,
  getLlmHistory,
  type StoredChatTurn,
} from '../services/ai-chat.service';
import type { AIQueryDossierBrief, AIQuerySourceRef, AIQueryTimelineMeta } from '../types';
import { buildDossierDigestBlock } from '../services/dossier-digest.service';
import {
  fetchAllTimelineEvents,
  fetchScenarioTimelineEvents,
  purchaseLabelFromEvents,
} from '../services/timeline-data.service';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const TIMELINE_GLOBAL = '__TIMELINE_GLOBAL__';
const TIMELINE_SCENARIO_PREFIX = '__TIMELINE_SCENARIO__:';

const QUERY_SYSTEM = `Tu es un assistant intelligent pour un système de gestion de factures et de rapprochement bancaire.
Tu reçois la liste brute des enregistrements (documents, mouvements, rapprochements) extraits de la base applicative — il n’y a pas de SQL : tu fais toi-même la recherche et le filtrage sur ces lignes.

Historique : les messages précédents (utilisateur / assistant) sont le fil de la conversation ; seul le DERNIER message utilisateur contient les données à jour. Réponds toujours en t’appuyant sur les données du dernier message.

Comportement attendu :
- Interprète les intentions en langage naturel même si la question est vague ou imprécise (montant approximatif, période floue, « le bon de commande chez X », etc.).
- Orthographe et noms : si l’utilisateur écrit mal un fournisseur ou un libellé, rapproche-le des entrées réelles (similarité visuelle, sous-chaînes, mots-clés, abréviations). Propose le ou les enregistrements les plus plausibles ; si plusieurs candidats, dis-le clairement et cite-les.
- Dates : utilise la date de référence fournie dans le contexte pour interpréter « cette semaine », « la semaine dernière », « le mois dernier », etc., en te basant sur les champs date des lignes.
- Montants : accepte les formulations du type « environ 500 € », « vers 500 », et compare avec une tolérance raisonnable (ex. quelques % ou quelques euros) sauf si l’utilisateur exige l’exactitude.
- Croise documents et mouvements quand la question le suggère (ex. paiement / facture / fournisseur dans le libellé).
- Si aucun enregistrement ne correspond, dis-le honnêtement et résume ce qui s’en rapproche le plus.

Frise chronologique (parcours d’achat) :
- Une frise décrit UNE chaîne d’achat : devis / commande → livraison ou réception → facture → paiement bancaire, pour un même dossier (colonne « Scenario » dans les DONNÉES = identifiant interne de ce parcours).
- Si l’utilisateur demande la timeline, la frise, la chronologie ou le déroulé pour un achat, un fournisseur ou une commande identifiable, ajoute ${TIMELINE_SCENARIO_PREFIX}<scenario_id> avec le scenario_id EXACT d’une ligne DONNÉES (ne pas inventer).
- N’ajoute ${TIMELINE_GLOBAL} que si l’utilisateur demande explicitement une vue sur tous les achats ou toutes les chaînes à la fois (vue globale).
- Quand tu inclus un jeton frise, garde "answer" court (2 à 4 phrases) : le parcours détaillé s’affiche visuellement.

Dossiers / parcours d’achat (scenarioId) — questions du type : résumé, synthèse, état, points clés, anomalies, problèmes, étapes manquantes, ce qui reste à faire, comparaison entre dossiers :
- Utilise impérativement le bloc SYNTHESE_AUTOMATIQUE_PAR_PARCOURS du message (étapes et alertes heuristiques) et les lignes DOCUMENTS.
- Dans "answer", structure clairement : (1) synthèse du dossier concerné, (2) étapes / pièces déjà présentes dans l’ordre chronologique ou métier, (3) anomalies ou risques (écarts de rapprochement, facture sans paiement, chaîne incomplète, incohérences de montants), (4) si pertinent, pistes ou prochaines vérifications.
- Si la question cible un ou plusieurs parcours identifiables, remplis "dossierBriefs" (voir schéma). Si la question ne porte pas sur un dossier (ex. simple recherche de montant), mets "dossierBriefs": [].
- Pour un résumé « de tous les dossiers », tu peux fournir un objet par scenarioId distinct.
- Ne invente pas d’IDs : reprends les scenarioId listés dans les données ou la synthèse automatique.

Réponds en français. Quand tu t’appuies sur des faits issus des données, inclus références et montants.
Réponds au format JSON strict :
{
  "answer": "<ta réponse détaillée>",
  "sources": ["<IDs exacts des lignes citées : documents, mouvements ou rapprochements, ou jetons spéciaux timeline ci-dessus>"],
  "dossierBriefs": [
    {
      "scenarioId": "<id parcours ou null si plusieurs dossiers mélangés>",
      "libelle": "<fournisseur ou titre court, optionnel>",
      "resume": "<synthèse en 2 à 5 phrases>",
      "etapes": ["<étape ou pièce clé 1>", "..."],
      "anomalies": ["<alerte ou anomalie 1>", "..."],
      "pistes": ["<piste ou action conseillée 1>", "..."]
    }
  ]
}
Si aucun dossier n’est concerné, utilise "dossierBriefs": [].
Réponds UNIQUEMENT avec le JSON, sans markdown.`;

function normalizeSourceIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string' && item.trim()) out.push(item.trim());
    else if (item && typeof item === 'object' && 'id' in item && typeof (item as { id: unknown }).id === 'string') {
      out.push((item as { id: string }).id.trim());
    }
  }
  return out;
}

function purchaseLabelForScenarioFromDocs(
  docById: Map<string, Record<string, unknown>>,
  scenarioId: string
): string | undefined {
  const evs: Record<string, unknown>[] = [];
  for (const d of docById.values()) {
    if (String(d.scenarioId ?? '') !== scenarioId) continue;
    evs.push({
      type: d.docType ?? d.type,
      fournisseur: d.fournisseur ?? d.from,
      scenarioId: d.scenarioId,
    });
  }
  return purchaseLabelFromEvents(evs, scenarioId);
}

function normalizeDossierBriefs(raw: unknown): AIQueryDossierBrief[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return undefined;
  const out: AIQueryDossierBrief[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const resume = typeof o.resume === 'string' ? o.resume : '';
    if (!resume.trim()) continue;
    const brief: AIQueryDossierBrief = { resume };
    if (o.scenarioId != null) brief.scenarioId = typeof o.scenarioId === 'string' ? o.scenarioId : String(o.scenarioId);
    if (typeof o.libelle === 'string') brief.libelle = o.libelle;
    if (Array.isArray(o.etapes)) brief.etapes = o.etapes.filter((x) => typeof x === 'string') as string[];
    if (Array.isArray(o.anomalies)) brief.anomalies = o.anomalies.filter((x) => typeof x === 'string') as string[];
    if (Array.isArray(o.pistes)) brief.pistes = o.pistes.filter((x) => typeof x === 'string') as string[];
    out.push(brief);
  }
  return out;
}

function parseAgentJson(result: string): {
  answer: string;
  sources: string[];
  dossierBriefs?: AIQueryDossierBrief[];
} {
  const cleaned = result.replace(/```json?\n?/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned) as { answer?: string; sources?: unknown; dossierBriefs?: unknown };
  const dossierBriefs = normalizeDossierBriefs(parsed.dossierBriefs);
  return {
    answer: typeof parsed.answer === 'string' ? parsed.answer : '',
    sources: normalizeSourceIds(parsed.sources),
    ...(dossierBriefs !== undefined ? { dossierBriefs } : {}),
  };
}

async function loadDataset(): Promise<{
  context: string;
  docById: Map<string, Record<string, unknown>>;
  mouvById: Map<string, Record<string, unknown>>;
  rappById: Map<string, Record<string, unknown>>;
}> {
  const documentKeys = (await redis.keys('document:*')).filter(
    (k: string) => !k.includes(':pdf') && !k.includes(':pending') && k !== 'document:ids'
  );
  const mouvementKeys = (await redis.keys('mouvement:*')).filter((k: string) => k !== 'mouvement:ids');
  const rapprochementKeys = (await redis.keys('rapprochement:*')).filter((k: string) => k !== 'rapprochement:ids');

  const documents = await Promise.all(
    documentKeys.map(async (k: string) => {
      const data = await redis.get(k);
      return data ? JSON.parse(data) : null;
    })
  );

  const mouvements = await Promise.all(
    mouvementKeys.map(async (k: string) => {
      const data = await redis.get(k);
      return data ? JSON.parse(data) : null;
    })
  );

  const rapprochements = await Promise.all(
    rapprochementKeys.map(async (k: string) => {
      const data = await redis.get(k);
      return data ? JSON.parse(data) : null;
    })
  );

  const allDocs = documents.filter(Boolean) as Record<string, unknown>[];
  const allMouv = mouvements.filter(Boolean) as Record<string, unknown>[];
  const allRapp = rapprochements.filter(Boolean) as Record<string, unknown>[];

  const docById = new Map<string, Record<string, unknown>>();
  for (const d of allDocs) {
    const id = d.id as string;
    if (id) docById.set(id, d);
  }
  const mouvById = new Map<string, Record<string, unknown>>();
  for (const m of allMouv) {
    const id = m.id as string;
    if (id) mouvById.set(id, m);
  }
  const rappById = new Map<string, Record<string, unknown>>();
  for (const r of allRapp) {
    const id = r.id as string;
    if (id) rappById.set(id, r);
  }

  const today = new Date().toISOString().slice(0, 10);
  const context = `
DATE_DE_REFERENCE_POUR_RELATIF: ${today} (format AAAA-MM-JJ ; sert à interpréter « semaine dernière », « hier », etc.)

DONNÉES DISPONIBLES:

DOCUMENTS (${allDocs.length}):
${allDocs
  .map(
    (d) =>
      `- ID: ${d.id} | Type: ${d.docType || d.type} | Montant: ${d.montant ?? '-'} | Date: ${d.date} | Fournisseur: ${d.fournisseur || d.from || ''} | Ref: ${d.reference || d.subject || ''} | Parcours (id chaîne): ${d.scenarioId || 'aucun'}`
  )
  .join('\n')}

MOUVEMENTS BANCAIRES (${allMouv.length}):
${allMouv
  .map(
    (m) =>
      `- ID: ${m.id} | Montant: ${m.montant} | Date: ${m.date} | Libellé: ${m.libelle} | Type: ${m.type_mouvement}`
  )
  .join('\n')}

RAPPROCHEMENTS (${allRapp.length}):
${allRapp
  .map(
    (r) =>
      `- ID: ${r.id} | Mouvement: ${r.mouvementId} | Factures: ${(r.factureIds as string[])?.join(', ')} | Écart: ${r.ecart} | Status: ${r.status}`
  )
  .join('\n')}
${buildDossierDigestBlock(docById, rappById)}
`;

  return { context, docById, mouvById, rappById };
}

async function enrichSources(ids: string[], docById: Map<string, Record<string, unknown>>, mouvById: Map<string, Record<string, unknown>>, rappById: Map<string, Record<string, unknown>>): Promise<AIQuerySourceRef[]> {
  const refs: AIQuerySourceRef[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    const key = id;
    if (seen.has(key)) continue;
    seen.add(key);

    if (id === TIMELINE_GLOBAL) {
      refs.push({
        id: TIMELINE_GLOBAL,
        kind: 'timeline_global',
        label: "Tous les parcours d'achat (vue globale)",
      });
      continue;
    }
    if (id.startsWith(TIMELINE_SCENARIO_PREFIX)) {
      const scenarioId = id.slice(TIMELINE_SCENARIO_PREFIX.length).trim();
      const purchaseLabel = scenarioId ? purchaseLabelForScenarioFromDocs(docById, scenarioId) : undefined;
      refs.push({
        id,
        kind: 'timeline_scenario',
        label: purchaseLabel ? `Parcours d'achat — ${purchaseLabel}` : `Parcours d'achat`,
        scenarioId: scenarioId || undefined,
      });
      continue;
    }

    const doc = docById.get(id);
    if (doc) {
      const type = String(doc.docType || doc.type || 'document');
      const ref = String(doc.reference || doc.subject || '');
      const four = String(doc.fournisseur || doc.from || '');
      const pdfKey = `document:${id}:pdf`;
      const pdfBlob = await redis.get(pdfKey);
      refs.push({
        id,
        kind: 'document',
        label: [type, ref, four].filter(Boolean).join(' · ') || id,
        hasPdf: Boolean(pdfBlob),
      });
      continue;
    }

    const mouv = mouvById.get(id);
    if (mouv) {
      refs.push({
        id,
        kind: 'mouvement',
        label: `${mouv.date} · ${mouv.montant} € · ${mouv.libelle}`,
      });
      continue;
    }

    const rapp = rappById.get(id);
    if (rapp) {
      refs.push({
        id,
        kind: 'rapprochement',
        label: `Rapprochement ${rapp.status} · écart ${rapp.ecart}`,
      });
      continue;
    }

    refs.push({ id, kind: 'unknown', label: id });
  }

  return refs;
}

async function attachTimelinePayload(
  sources: AIQuerySourceRef[]
): Promise<{ events: Record<string, unknown>[]; meta: AIQueryTimelineMeta } | null> {
  const hasGlobal = sources.some((s) => s.kind === 'timeline_global');
  const scenario = sources.find((s) => s.kind === 'timeline_scenario' && s.scenarioId);
  if (hasGlobal) {
    const events = await fetchAllTimelineEvents();
    return { events, meta: { scope: 'global' } };
  }
  if (scenario?.scenarioId) {
    const events = await fetchScenarioTimelineEvents(scenario.scenarioId);
    const purchaseLabel = purchaseLabelFromEvents(events, scenario.scenarioId);
    return {
      events,
      meta: { scope: 'scenario', scenarioId: scenario.scenarioId, purchaseLabel },
    };
  }
  return null;
}

function buildDataUserMessage(context: string, userQuery: string): string {
  return `=== DONNÉES À JOUR (source de vérité pour cette réponse) ===
${context}
=== QUESTION ===
${userQuery}`;
}

function toOpenAiHistory(llmStored: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];
  for (const m of llmStored) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    const content = typeof m.content === 'string' ? m.content : String(m.content ?? '');
    if (m.role === 'user') out.push({ role: 'user', content });
    else out.push({ role: 'assistant', content });
  }
  return out;
}

export async function queryData(
  sessionId: string,
  userQuery: string
): Promise<{
  answer: string;
  sources: AIQuerySourceRef[];
  sessionId: string;
  timelineEvents?: Record<string, unknown>[];
  timelineMeta?: AIQueryTimelineMeta;
  dossierBriefs?: AIQueryDossierBrief[];
}> {
  const { context, docById, mouvById, rappById } = await loadDataset();
  const llmStored = await getLlmHistory(sessionId);
  const historyForApi = toOpenAiHistory(llmStored);
  const userMessage = buildDataUserMessage(context, userQuery);

  const raw = await callAgentWithHistory(QUERY_SYSTEM, historyForApi, userMessage);
  let parsed: { answer: string; sources: string[]; dossierBriefs?: AIQueryDossierBrief[] };
  try {
    parsed = parseAgentJson(raw);
  } catch {
    parsed = { answer: raw || 'Réponse non interprétée.', sources: [] };
  }

  const sources = await enrichSources(parsed.sources, docById, mouvById, rappById);

  const timelinePayload = await attachTimelinePayload(sources);

  await appendLlmTurns(sessionId, userQuery, parsed.answer);

  const briefs = parsed.dossierBriefs;

  const turn: StoredChatTurn = {
    question: userQuery,
    answer: parsed.answer,
    sources,
    at: new Date().toISOString(),
    ...(timelinePayload
      ? { timelineEvents: timelinePayload.events, timelineMeta: timelinePayload.meta }
      : {}),
    ...(briefs && briefs.length ? { dossierBriefs: briefs } : {}),
  };
  await appendTurn(sessionId, turn);

  return {
    answer: parsed.answer,
    sources,
    sessionId,
    ...(timelinePayload
      ? { timelineEvents: timelinePayload.events, timelineMeta: timelinePayload.meta }
      : {}),
    ...(briefs && briefs.length ? { dossierBriefs: briefs } : {}),
  };
}
