import redis from './redis.service';

const ALL_TYPES = ['document', 'mouvement'];

/** Étapes typiques d’un parcours d’achat (bon de commande → … → paiement) — hors emails hors contexte */
const PURCHASE_FLOW_TYPES = new Set([
  'devis',
  'bon_commande',
  'bon_livraison',
  'bon_reception',
  'facture',
  'email',
  'mouvement',
]);

function mapDocToEvent(doc: Record<string, unknown>, docType: string): Record<string, unknown> {
  return {
    id: doc.id,
    type: doc.type || docType,
    date: doc.date,
    reference: doc.reference || doc.subject || doc.libelle || '',
    fournisseur: doc.fournisseur || doc.from || '',
    montant: doc.montant ?? null,
    scenarioId: doc.scenarioId ?? null,
    subject: doc.subject ?? null,
    hasRelation: doc.hasRelation ?? null,
    relationType: doc.relationType ?? null,
    fileName: doc.fileName ?? null,
  };
}

function isPurchaseFlowEvent(ev: Record<string, unknown>): boolean {
  const t = String(ev.type ?? '');
  if (!PURCHASE_FLOW_TYPES.has(t)) return false;
  const sid = ev.scenarioId;
  return sid != null && String(sid).trim() !== '';
}

/** Tri chronologique dans un même parcours */
function sortPurchaseFlowChronological(events: Record<string, unknown>[]): void {
  events.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

/** Vue globale : un parcours après l’autre (par scénario), puis date */
function sortGlobalPurchaseFlows(events: Record<string, unknown>[]): void {
  events.sort((a, b) => {
    const sa = String(a.scenarioId ?? '');
    const sb = String(b.scenarioId ?? '');
    if (sa !== sb) return sa.localeCompare(sb);
    return String(a.date || '').localeCompare(String(b.date || ''));
  });
}

/**
 * Libellé métier pour un parcours (fournisseur), pas l’identifiant technique S01.
 */
export function purchaseLabelFromEvents(
  events: Record<string, unknown>[],
  scenarioId?: string
): string | undefined {
  const list = scenarioId
    ? events.filter((e) => String(e.scenarioId ?? '') === scenarioId)
    : events;
  const prefer = ['bon_commande', 'facture', 'devis', 'bon_livraison', 'bon_reception'];
  for (const typ of prefer) {
    const ev = list.find((e) => String(e.type ?? '') === typ && (e.fournisseur || e['fournisseur']));
    if (ev) {
      const f = ev.fournisseur ?? ev['fournisseur'];
      if (f != null && String(f).trim() !== '') return String(f).trim();
    }
  }
  for (const ev of list) {
    const f = ev.fournisseur ?? ev['fournisseur'];
    if (f != null && String(f).trim() !== '') return String(f).trim();
  }
  return undefined;
}

async function collectAllRawEvents(): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  for (const docType of ALL_TYPES) {
    const ids = await redis.smembers(`${docType}:ids`);
    for (const id of ids) {
      const data = await redis.get(`${docType}:${id}`);
      if (!data) continue;
      const doc = JSON.parse(data) as Record<string, unknown>;
      events.push(mapDocToEvent(doc, docType));
    }
  }
  return events;
}

/**
 * Tous les événements liés à un parcours d’achat (chaîne documentaire + paiement), pas les pièces isolées.
 */
export async function fetchAllTimelineEvents(): Promise<Record<string, unknown>[]> {
  const raw = await collectAllRawEvents();
  const events = raw.filter(isPurchaseFlowEvent);
  sortGlobalPurchaseFlows(events);
  return events;
}

/**
 * Un seul parcours d’achat : de la commande à la facture / paiement, ordre chronologique.
 */
export async function fetchScenarioTimelineEvents(scenarioId: string): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  for (const docType of ALL_TYPES) {
    const ids = await redis.smembers(`${docType}:ids`);
    for (const id of ids) {
      const data = await redis.get(`${docType}:${id}`);
      if (!data) continue;
      const doc = JSON.parse(data) as Record<string, unknown>;
      if (doc.scenarioId === scenarioId) {
        const ev = mapDocToEvent(doc, docType);
        if (isPurchaseFlowEvent(ev)) events.push(ev);
      }
    }
  }
  sortPurchaseFlowChronological(events);
  return events;
}
