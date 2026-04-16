import axios, { AxiosError } from 'axios';
import { getAccessToken, getIonBaseUrl, invalidateTokenCache } from './ion-auth.service';

// ── Intercepteur HTTP (logging des appels ION/M3) ─────────────────────────
axios.interceptors.request.use((config) => {
  const params = config.params ? `\n  params  : ${JSON.stringify(config.params)}` : '';
  console.log(`[HTTP →] ${config.method?.toUpperCase()} ${config.url}${params}`);
  console.log(`[HTTP →] headers :`, JSON.stringify(config.headers, null, 2));
  (config as any)._t = Date.now();
  return config;
});

axios.interceptors.response.use(
  (response) => {
    const ms = Date.now() - ((response.config as any)._t ?? Date.now());
    const records = response.data?.results?.reduce((acc: number, t: any) => acc + (t.records?.length ?? 0), 0);
    const suffix = records != null ? ` — ${records} enreg.` : '';
    console.log(`[HTTP ←] ${response.status} ${response.config.url} (${ms}ms)${suffix}`);
    console.log(`[HTTP ←] body :`, JSON.stringify(response.data, null, 2));
    return response;
  },
  (error: AxiosError) => {
    const ms = Date.now() - ((error.config as any)?._t ?? Date.now());
    console.error(`[HTTP ✗] ${error.response?.status ?? 'ERR'} ${error.config?.url} (${ms}ms) — ${error.message}`);
    if (error.response?.data) {
      console.error(`         détail :`, JSON.stringify(error.response.data).slice(0, 300));
    }
    return Promise.reject(error);
  }
);

export interface M3CallOptions {
  /** Nombre maximum d'enregistrements retournés (défaut : 100) */
  maxrecs?: number;
  /** Colonnes à retourner, séparées par virgule (vide = toutes) */
  returncols?: string;
  /** Méthode HTTP : GET pour les transactions Lst/Get, POST pour Add/Upd/Dlt (défaut : GET) */
  method?: 'GET' | 'POST';
}

export interface M3Record {
  [field: string]: string;
}

export interface M3TransactionResult {
  transaction: string;
  records: M3Record[];
}

export interface M3Response {
  results?: M3TransactionResult[];
  wasTerminated?: boolean;
  nrOfSuccessfullTransactions?: number;
  nrOfFailedTransactions?: number;
  ErrorMessage?: string;
  ErrorCode?: string;
}

/**
 * Appelle une transaction M3 via ION API REST v2.
 *
 * @param program     Nom du programme M3 (ex : "CRS610MI")
 * @param transaction Nom de la transaction (ex : "LstSupplier")
 * @param data        Paramètres d'entrée (ex : { CONO: "1", SUNO: "SUP001" })
 * @param options     Options supplémentaires (maxrecs, returncols, méthode HTTP)
 */
export async function callM3API(
  program: string,
  transaction: string,
  data: Record<string, string> = {},
  options: M3CallOptions = {}
): Promise<M3Response> {
  const token = await getAccessToken();
  const baseUrl = (await getIonBaseUrl()).replace(/\/$/, ''); // normaliser sans slash final
  const url = `${baseUrl}/M3/m3api-rest/v2/execute/${program}/${transaction}`;
  const method = options.method ?? 'GET';

  const params: Record<string, string> = {
    ...data,
    maxrecs: String(options.maxrecs ?? 100),
  };
  if (options.returncols) {
    params.returncols = options.returncols;
  }

  console.log(`[M3] token (50 premiers chars) : ${token ? token.slice(0, 50) + '...' : '(vide !)'}`);

  try {
    const response = await axios({
      method,
      url,
      ...(method === 'GET' ? { params } : { data: params }),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });
    return response.data as M3Response;
  } catch (err) {
    const axiosErr = err as AxiosError;
    // Token expiré (401) → invalider le cache et relancer une fois
    if (axiosErr.response?.status === 401) {
      invalidateTokenCache();
      const freshToken = await getAccessToken();
      const retry = await axios({
        method,
        url,
        ...(method === 'GET' ? { params } : { data: params }),
        headers: {
          Authorization: `Bearer ${freshToken}`,
          Accept: 'application/json',
        },
      });
      return retry.data as M3Response;
    }
    throw err;
  }
}
