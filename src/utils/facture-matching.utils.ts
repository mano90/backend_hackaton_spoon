/** Pure helpers for facture duplicate detection (normalization + deterministic rules). */

const LEGAL_SUFFIX = /\b(sarl|sas|sa|eurl|sasu|sci|snc|selarl|selas)\b\.?$/gi;

/**
 * Fournisseur: trim, collapse spaces, lowercase, strip common French legal suffix for matching.
 */
export function normalizeFournisseur(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ').toLowerCase();
  s = s.replace(LEGAL_SUFFIX, '').trim();
  s = s.replace(/[,.\s]+$/g, '').trim();
  return s;
}

/**
 * Canonical reference key: alnum only, lowercase; each digit run without leading zeros (F-0045 ≡ F-45).
 */
export function normalizeReferenceKey(raw: string): string {
  const compact = raw
    .trim()
    .toLowerCase()
    .replace(/[\u00a0\s]+/g, '')
    .replace(/[^a-z0-9]/g, '');
  return compact.replace(/\d+/g, (run) => String(parseInt(run, 10)));
}

/** Montant TTC → centimes (integer) for safe equality. */
export function montantToCents(montant: number): number {
  return Math.round(Number(montant) * 100);
}

export interface FactureMatchFields {
  fournisseur: string;
  reference: string;
  montant: number;
}

/** Strict identity: same normalized supplier + reference + amount (centimes). */
export function isStrictTriplet(
  a: FactureMatchFields,
  b: FactureMatchFields
): boolean {
  if (normalizeFournisseur(a.fournisseur) !== normalizeFournisseur(b.fournisseur)) return false;
  if (normalizeReferenceKey(a.reference) !== normalizeReferenceKey(b.reference)) return false;
  return montantToCents(a.montant) === montantToCents(b.montant);
}

/** Single adjacent digit transposition (e.g. 1245€ vs 1254€ → centimes 124500 vs 125400). */
export function isSingleAdjacentDigitTransposition(a: number, b: number): boolean {
  const ca = montantToCents(a);
  const cb = montantToCents(b);
  if (ca === cb) return false;
  const sa = String(Math.abs(ca));
  const sb = String(Math.abs(cb));
  if (sa.length !== sb.length) return false;
  const diffs: number[] = [];
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) diffs.push(i);
  }
  if (diffs.length !== 2) return false;
  const [i, j] = diffs;
  if (j !== i + 1) return false;
  return sa[i] === sb[j] && sa[j] === sb[i];
}

/**
 * Same supplier + same normalized ref, amount differs only by adjacent transposition.
 */
export function isHumanErrorAmountDuplicate(
  a: FactureMatchFields,
  b: FactureMatchFields
): boolean {
  if (normalizeFournisseur(a.fournisseur) !== normalizeFournisseur(b.fournisseur)) return false;
  if (normalizeReferenceKey(a.reference) !== normalizeReferenceKey(b.reference)) return false;
  return isSingleAdjacentDigitTransposition(a.montant, b.montant);
}

export interface ExistingFactureLite {
  id: string;
  montant: number;
  date: string;
  fournisseur: string;
  reference: string;
  fileName: string;
}

export type DeterministicMatchType = 'strict_triplet' | 'human_error_amount';

/** First strict triplet, else first human-error amount match. */
export function findDeterministicDuplicate(
  newF: FactureMatchFields,
  existing: ExistingFactureLite[]
): {
  duplicateId: string;
  confidence: number;
  reason: string;
  matchType: DeterministicMatchType;
} | null {
  for (const ex of existing) {
    if (isStrictTriplet(newF, ex)) {
      return {
        duplicateId: ex.id,
        confidence: 99,
        reason:
          'Même fournisseur, même numéro de facture et même montant TTC (après normalisation des références et du nom).',
        matchType: 'strict_triplet',
      };
    }
  }
  for (const ex of existing) {
    if (isHumanErrorAmountDuplicate(newF, ex)) {
      return {
        duplicateId: ex.id,
        confidence: 90,
        reason:
          'Même fournisseur et même référence ; écart de montant compatible avec une inversion de deux chiffres adjacents.',
        matchType: 'human_error_amount',
      };
    }
  }
  return null;
}

/**
 * Reduce list for LLM: same fournisseur OR same ref key OR amount within ±2% OR date within 7 days.
 */
export function filterCandidatesForLlm(
  newFacture: FactureMatchFields & { date: string; rawText: string },
  existing: ExistingFactureLite[],
  maxCandidates = 40
): ExistingFactureLite[] {
  const nf = normalizeFournisseur(newFacture.fournisseur);
  const nr = normalizeReferenceKey(newFacture.reference);
  const cents = montantToCents(newFacture.montant);
  const newDate = parseDateSafe(newFacture.date);

  const scored = existing
    .map((ex) => {
      let score = 0;
      if (normalizeFournisseur(ex.fournisseur) === nf) score += 3;
      if (normalizeReferenceKey(ex.reference) === nr) score += 3;
      const ec = montantToCents(ex.montant);
      if (cents > 0 && ec > 0) {
        const ratio = Math.abs(cents - ec) / Math.max(cents, ec);
        if (ratio <= 0.02) score += 2;
      }
      const exDate = parseDateSafe(ex.date);
      if (newDate && exDate) {
        const days = Math.abs(newDate.getTime() - exDate.getTime()) / (86400 * 1000);
        if (days <= 7) score += 1;
      }
      return { ex, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCandidates)
    .map((x) => x.ex);

  if (scored.length > 0) return scored;
  return existing.slice(0, maxCandidates);
}

function parseDateSafe(s: string): Date | null {
  if (!s || !s.trim()) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
