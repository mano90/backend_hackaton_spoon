import redis from './redis.service';
const CACHE_PREFIX = 'fraud:cache:sirene:';
const CACHE_TTL_SEC = 7 * 24 * 3600;

export interface SireneUniteLegaleInfo {
  siren: string;
  dateCreationUniteLegale?: string;
  /** Code pays du siège si présent (ex. pour comparaison IBAN). */
  paysSiege?: string;
}

function parseInseeDate(isoLike: string | undefined): Date | null {
  if (!isoLike || typeof isoLike !== 'string') return null;
  const d = new Date(isoLike.slice(0, 10));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Âge en jours depuis la création de l’unité légale (null si inconnu). */
export function daysSinceCompanyCreation(dateCreation: string | undefined): number | null {
  const d = parseInseeDate(dateCreation);
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000));
}

export async function fetchUniteLegale(siren: string): Promise<SireneUniteLegaleInfo | null> {
  const token = process.env.INSEE_API_KEY?.trim();
  if (!token) return null;

  const cacheKey = `${CACHE_PREFIX}${siren}`;
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as SireneUniteLegaleInfo;
    } catch {
      /* ignore */
    }
  }

  const base =
    process.env.INSEE_API_BASE?.replace(/\/$/, '') || 'https://api.insee.fr/entreprise/sirene/V3.11';
  const url = `${base}/siren/${encodeURIComponent(siren)}`;

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      await redis.set(cacheKey, JSON.stringify(null), 'EX', 3600);
      return null;
    }
    const data = (await res.json()) as {
      uniteLegale?: {
        siren?: string;
        dateCreationUniteLegale?: string;
        categorieJuridiqueUniteLegale?: string;
      };
    };
    const ul = data.uniteLegale;
    if (!ul?.siren) return null;
    const info: SireneUniteLegaleInfo = {
      siren: ul.siren,
      dateCreationUniteLegale: ul.dateCreationUniteLegale,
      paysSiege: 'FR',
    };
    await redis.set(cacheKey, JSON.stringify(info), 'EX', CACHE_TTL_SEC);
    return info;
  } catch {
    return null;
  }
}
