import redis from './redis.service';

const REDIS_KEY = 'ion:config';

export interface IonConfig {
  /** URL du token OAuth (pu + '/' + ot du fichier .ionapi) */
  tokenUrl: string;
  /** Client ID OAuth (champ "ci") */
  clientId: string;
  /** Client Secret OAuth (champ "cs") */
  clientSecret: string;
  /** URL de base ION API — https://mingle-portal.eu1.inforcloudsuite.com/v2/{ti} */
  baseUrl: string;
  /** Service Account Access Key (champ "saak") */
  saak: string;
  /** Service Account Secret Key (champ "sask") */
  sask: string;
  /** Libellé optionnel pour identifier la connexion */
  label?: string;
}

const EMPTY: IonConfig = {
  tokenUrl: '',
  clientId: '',
  clientSecret: '',
  baseUrl: '',
  saak: '',
  sask: '',
  label: '',
};

export async function getIonConfig(): Promise<IonConfig> {
  const raw = await redis.get(REDIS_KEY);
  if (!raw) return { ...EMPTY };
  try {
    return { ...EMPTY, ...(JSON.parse(raw) as Partial<IonConfig>) };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveIonConfig(partial: Partial<IonConfig>): Promise<IonConfig> {
  const current = await getIonConfig();
  const updated: IonConfig = { ...current, ...partial };
  await redis.set(REDIS_KEY, JSON.stringify(updated));
  return updated;
}

export function isConfigured(config: IonConfig): boolean {
  return !!(config.tokenUrl && config.clientId && config.clientSecret && config.baseUrl && config.saak && config.sask);
}
