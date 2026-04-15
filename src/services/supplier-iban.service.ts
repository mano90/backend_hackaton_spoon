import redis from './redis.service';
import { normalizeIban } from '../utils/iban.util';
import { normalizeSiren } from '../utils/siren.util';

const PREFIX = 'fraud:supplier:iban:';

export function supplierKeyFromDoc(doc: Record<string, unknown>): string {
  const ex = {
    siren: doc.siren as string | undefined,
    siret: doc.siret as string | undefined,
  };
  const siren = normalizeSiren(ex);
  if (siren) return `siren:${siren}`;
  const n = String(doc.fournisseur || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return `name:${n || 'unknown'}`;
}

export async function getKnownIbansForSupplier(supplierKey: string): Promise<string[]> {
  const raw = await redis.get(`${PREFIX}${supplierKey}`);
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Enregistre l’IBAN observé pour les prochains contrôles (après analyse fraude). */
export async function registerIbanForSupplier(supplierKey: string, ibanRaw: string | null | undefined): Promise<void> {
  const iban = normalizeIban(ibanRaw || '');
  if (!iban) return;
  const prev = await getKnownIbansForSupplier(supplierKey);
  const next = [...new Set([...prev, iban])];
  await redis.set(`${PREFIX}${supplierKey}`, JSON.stringify(next));
}

export function isRibChangeVersusHistory(ibanRaw: string | null | undefined, previousIbans: string[]): boolean {
  const iban = normalizeIban(ibanRaw || '');
  if (!iban) return false;
  return previousIbans.length > 0 && !previousIbans.includes(iban);
}
