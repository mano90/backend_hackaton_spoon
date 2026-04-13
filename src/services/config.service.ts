import redis from './redis.service';

const CONFIG_KEY = 'rapprochement:config';

export interface RapprochementConfig {
  // SA-4 : frais bancaires
  bankFeesMaxEcart: number;            // défaut : 100 EUR
  // SA-4 : escompte commercial
  discountMaxWithoutProof: number;     // défaut : 5 (%) — de 0 à 100
  discountAbsoluteMax: number;         // défaut : 40 (%) — de 0 à 100
  // SA-4 : paiement groupé
  groupedPaymentTolerance: number;     // défaut : 2 (%)
  // SA-4 : taux de change
  exchangeRateTolerance: number;       // défaut : 5 (%)
}

export const DEFAULT_CONFIG: RapprochementConfig = {
  bankFeesMaxEcart: 100,
  discountMaxWithoutProof: 5,
  discountAbsoluteMax: 40,
  groupedPaymentTolerance: 2,
  exchangeRateTolerance: 5,
};

export async function getConfig(): Promise<RapprochementConfig> {
  const raw = await redis.get(CONFIG_KEY);
  if (!raw) return { ...DEFAULT_CONFIG };
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(partial: Partial<RapprochementConfig>): Promise<RapprochementConfig> {
  const current = await getConfig();
  const updated = { ...current, ...partial };
  await redis.set(CONFIG_KEY, JSON.stringify(updated));
  return updated;
}
