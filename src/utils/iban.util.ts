/** Normalise un IBAN (espaces supprimés, majuscules). */
export function normalizeIban(raw: string | null | undefined): string | null {
  if (raw == null || typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (s.length < 15 || s.length > 34) return null;
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(s)) return null;
  return s;
}

/** Code pays ISO 3166-1 alpha-2 depuis l’IBAN (positions 1-2). */
export function ibanCountryCode(iban: string | null | undefined): string | null {
  const n = normalizeIban(iban || '');
  if (!n || n.length < 2) return null;
  return n.slice(0, 2);
}
