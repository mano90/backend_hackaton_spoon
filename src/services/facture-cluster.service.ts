import redis from './redis.service';
import { checkFactureSimilarity } from '../agents/similarity.agent';
import {
  type ExistingFactureLite,
  filterCandidatesForLlm,
  isHumanErrorAmountDuplicate,
  isStrictTriplet,
  normalizeFournisseur,
  montantToCents,
} from '../utils/facture-matching.utils';
import { sha256Buffer } from './document-hash.service';

export type ClusterEdgeReason =
  | 'byte_identical'
  | 'strict_triplet'
  | 'human_error_amount'
  | 'multi_channel';

export interface DuplicateGroup {
  ids: string[];
  reasons: ClusterEdgeReason[];
}

class UnionFind {
  parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    const p = this.parent.get(x)!;
    if (p !== x) {
      this.parent.set(x, this.find(p));
    }
    return this.parent.get(x)!;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

async function loadAllFactureDocuments(): Promise<Record<string, unknown>[]> {
  const ids = await redis.smembers('document:ids');
  const out: Record<string, unknown>[] = [];
  for (const id of ids) {
    const data = await redis.get(`document:${id}`);
    if (!data) continue;
    const d = JSON.parse(data) as Record<string, unknown>;
    if (d.docType === 'facture' || d.type === 'facture') out.push(d);
  }
  return out;
}

function toLite(d: Record<string, unknown>): ExistingFactureLite {
  return {
    id: String(d.id),
    montant: Number(d.montant) || 0,
    date: String(d.date ?? ''),
    fournisseur: String(d.fournisseur ?? ''),
    reference: String(d.reference ?? ''),
    fileName: String(d.fileName ?? ''),
  };
}

export interface ClusterOptions {
  /** Optional LLM pass for pairs that are close but not merged by rules/hash (default 0). */
  maxLlmCalls?: number;
}

/**
 * Regroupe les factures (documents) par hash identique, triplet strict, erreur de saisie,
 * puis optionnellement par similarité LLM avec budget d'appels.
 */
export async function clusterFactureDuplicates(options: ClusterOptions = {}): Promise<{
  groups: DuplicateGroup[];
  llmCallsUsed: number;
}> {
  const docs = await loadAllFactureDocuments();
  const maxLlm = options.maxLlmCalls ?? 0;

  if (docs.length === 0) {
    return { groups: [], llmCallsUsed: 0 };
  }

  const uf = new UnionFind();
  const reasons = new Map<string, Set<ClusterEdgeReason>>();

  const addEdge = (a: string, b: string, reason: ClusterEdgeReason) => {
    uf.union(a, b);
    const key = [a, b].sort().join('|');
    if (!reasons.has(key)) reasons.set(key, new Set());
    reasons.get(key)!.add(reason);
  };

  const byId = new Map<string, Record<string, unknown>>();
  for (const d of docs) {
    byId.set(String(d.id), d);
    uf.find(String(d.id));
  }

  // Phase A: même SHA-256 (champ stocké ou calculé depuis PDF)
  const hashToIds = new Map<string, string[]>();
  for (const d of docs) {
    const id = String(d.id);
    let h = d.contentSha256 as string | undefined;
    if (!h || !/^[a-f0-9]{64}$/i.test(h)) {
      const pdf = await redis.get(`document:${id}:pdf`);
      if (pdf) {
        h = sha256Buffer(Buffer.from(pdf, 'base64'));
      }
    }
    if (!h) continue;
    if (!hashToIds.has(h)) hashToIds.set(h, []);
    hashToIds.get(h)!.push(id);
  }
  for (const ids of hashToIds.values()) {
    if (ids.length < 2) continue;
    const root = ids[0];
    for (let i = 1; i < ids.length; i++) addEdge(root, ids[i], 'byte_identical');
  }

  const lites = docs.map(toLite);

  // Phase B: triplets stricts + erreur humaine (paires)
  for (let i = 0; i < lites.length; i++) {
    for (let j = i + 1; j < lites.length; j++) {
      const a = lites[i];
      const b = lites[j];
      if (isStrictTriplet(a, b)) addEdge(a.id, b.id, 'strict_triplet');
      else if (isHumanErrorAmountDuplicate(a, b)) addEdge(a.id, b.id, 'human_error_amount');
    }
  }

  let llmCallsUsed = 0;

  // Phase C: LLM sur paires "proches" non déjà dans la même composante
  if (maxLlm > 0) {
    const ordered = [...lites].sort((x, y) => x.id.localeCompare(y.id));
    for (let i = 0; i < ordered.length && llmCallsUsed < maxLlm; i++) {
      for (let j = i + 1; j < ordered.length && llmCallsUsed < maxLlm; j++) {
        const a = ordered[i];
        const b = ordered[j];
        if (uf.find(a.id) === uf.find(b.id)) continue;

        const nf = normalizeFournisseur(a.fournisseur);
        const ng = normalizeFournisseur(b.fournisseur);
        if (nf !== ng) continue;

        const ca = montantToCents(a.montant);
        const cb = montantToCents(b.montant);
        if (ca > 0 && cb > 0) {
          const ratio = Math.abs(ca - cb) / Math.max(ca, cb);
          if (ratio > 0.02) continue;
        }

        const da = new Date(a.date);
        const db = new Date(b.date);
        if (!Number.isNaN(da.getTime()) && !Number.isNaN(db.getTime())) {
          const days = Math.abs(da.getTime() - db.getTime()) / (86400 * 1000);
          if (days > 14) continue;
        }

        const docA = byId.get(a.id)!;
        const rawText = String(docA.rawText ?? '').slice(0, 4000);
        const candidates = filterCandidatesForLlm(
          {
            montant: a.montant,
            date: a.date,
            fournisseur: a.fournisseur,
            reference: a.reference,
            rawText,
          },
          [b],
          5
        );
        if (candidates.length === 0) continue;

        const sim = await checkFactureSimilarity(
          {
            montant: a.montant,
            date: a.date,
            fournisseur: a.fournisseur,
            reference: a.reference,
            rawText,
            fileSize: 0,
          },
          candidates
        );
        llmCallsUsed++;
        if (sim.hasDuplicate && sim.confidence >= 70 && sim.duplicateId === b.id) {
          addEdge(a.id, b.id, 'multi_channel');
        }
      }
    }
  }

  const rootToMembers = new Map<string, string[]>();
  for (const d of docs) {
    const id = String(d.id);
    const r = uf.find(id);
    if (!rootToMembers.has(r)) rootToMembers.set(r, []);
    rootToMembers.get(r)!.push(id);
  }

  const groups: DuplicateGroup[] = [];
  for (const members of rootToMembers.values()) {
    if (members.length < 2) continue;
    const edgeReasons = new Set<ClusterEdgeReason>();
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const key = [members[i], members[j]].sort().join('|');
        const rs = reasons.get(key);
        if (rs) rs.forEach((x) => edgeReasons.add(x));
      }
    }
    if (edgeReasons.size === 0) {
      const hashes = members
        .map((id) => byId.get(id)?.contentSha256 as string | undefined)
        .filter((h): h is string => typeof h === 'string' && /^[a-f0-9]{64}$/i.test(h));
      if (hashes.length === members.length && new Set(hashes).size === 1) {
        edgeReasons.add('byte_identical');
      }
    }
    groups.push({
      ids: members.sort(),
      reasons: Array.from(edgeReasons),
    });
  }

  groups.sort((a, b) => b.ids.length - a.ids.length);
  return { groups, llmCallsUsed };
}
