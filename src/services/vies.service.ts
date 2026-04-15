import redis from './redis.service';

const CACHE_PREFIX = 'fraud:cache:vies:';
const CACHE_TTL_SEC = 24 * 3600;

/** Retourne true si le numéro est valide côté VIES, false si invalide, null si indéterminé (erreur réseau / pas de clé). */
export async function checkViesVatValid(countryCode: string, vatDigits: string): Promise<boolean | null> {
  const cc = countryCode.toUpperCase();
  const num = vatDigits.replace(/\s+/g, '');
  if (cc.length !== 2 || num.length < 4) return null;

  const cacheKey = `${CACHE_PREFIX}${cc}:${num}`;
  const hit = await redis.get(cacheKey);
  if (hit === '1') return true;
  if (hit === '0') return false;
  if (hit === 'u') return null;

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
  <soapenv:Header/>
  <soapenv:Body>
    <urn:checkVat xmlns:urn="urn:ec.europa.eu:taxud:vies:services:checkVat:types">
      <urn:countryCode>${cc}</urn:countryCode>
      <urn:vatNumber>${num}</urn:vatNumber>
    </urn:checkVat>
  </soapenv:Body>
</soapenv:Envelope>`;

  try {
    const res = await fetch('https://ec.europa.eu/taxation_customs/vies/services/checkVatService', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        SOAPAction: '',
      },
      body: envelope,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    const m = /<valid>\s*(true|false)\s*<\/valid>/i.exec(text);
    if (!m) {
      await redis.set(cacheKey, 'u', 'EX', 300);
      return null;
    }
    const ok = m[1].toLowerCase() === 'true';
    await redis.set(cacheKey, ok ? '1' : '0', 'EX', CACHE_TTL_SEC);
    return ok;
  } catch {
    return null;
  }
}

export function parseTvaIntracomposable(raw: string | null | undefined): { country: string; number: string } | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.replace(/\s+/g, '').toUpperCase();
  if (s.length < 4) return null;
  const country = s.slice(0, 2);
  if (!/^[A-Z]{2}$/.test(country)) return null;
  const number = s.slice(2);
  if (number.length < 2) return null;
  return { country, number };
}
