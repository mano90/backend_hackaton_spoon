import redis from './redis.service';

const FRAUD_CONFIG_KEY = 'fraud:config';

export interface FraudConfig {
  /** Montants strictement inférieurs à ce seuil déclenchent un signal « phishing » (petites factures). */
  autoApprovalMaxAmount: number;
  /** Tolérance € pour HT + TVA ≈ TTC. */
  arithToleranceEuro: number;
  /** Unité légale plus jeune que ce nombre de jours → alerte « société récente ». */
  newCompanyMaxAgeDays: number;
  motsClefsPhishing: string[];
  /** Sous-chaînes d’adresse évoquant domiciliation de masse (configurable). */
  massAddressSubstrings: string[];
  /** Producteurs PDF considérés comme éditeurs (insensible à la casse). */
  pdfEditorProducerPatterns: string[];
}

export const DEFAULT_FRAUD_CONFIG: FraudConfig = {
  autoApprovalMaxAmount: 500,
  arithToleranceEuro: 0.02,
  newCompanyMaxAgeDays: 90,
  motsClefsPhishing: [
    'frais techniques',
    'frais technique',
    'maintenance',
    'annuaire',
    'nom de domaine',
    'hébergement',
    'redressement',
    'cotisation',
    'abonnement standard',
  ],
  massAddressSubstrings: [
    'domiciliation',
    "centre d'affaires",
    'centre d’affaires',
    'bp ',
    'cedex',
    'immeuble le ',
  ],
  pdfEditorProducerPatterns: [
    'adobe acrobat',
    'foxit',
    'pdf-xchange',
    'inkscape',
    'libreoffice',
    'nitro pdf',
    'pdfelement',
  ],
};

export async function getFraudConfig(): Promise<FraudConfig> {
  const raw = await redis.get(FRAUD_CONFIG_KEY);
  if (!raw) return { ...DEFAULT_FRAUD_CONFIG };
  try {
    return { ...DEFAULT_FRAUD_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_FRAUD_CONFIG };
  }
}

export async function saveFraudConfig(partial: Partial<FraudConfig>): Promise<FraudConfig> {
  const current = await getFraudConfig();
  const updated = { ...current, ...partial };
  await redis.set(FRAUD_CONFIG_KEY, JSON.stringify(updated));
  return updated;
}
