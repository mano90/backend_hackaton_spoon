import axios from 'axios';
import { getIonConfig, isConfigured } from './ion-config.service';

interface TokenCache {
  accessToken: string;
  expiresAt: number; // ms timestamp
}

let tokenCache: TokenCache | null = null;

/**
 * Retourne un Bearer Token valide via OAuth 2.0 client_credentials.
 * Les credentials sont lus depuis la configuration stockée en base (ION Config UI).
 * Le token est mis en cache et renouvelé automatiquement 60s avant expiration.
 */
export async function getAccessToken(): Promise<string> {
  // Retourner le token en cache si encore valide (buffer de 60s)
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken;
  }

  const config = await getIonConfig();
  if (!isConfigured(config)) {
    throw new Error(
      'Configuration ION API manquante. Veuillez renseigner les credentials dans la page M3 > Configuration.'
    );
  }

  const { data } = await axios.post(
    config.tokenUrl,
    new URLSearchParams({
      grant_type: 'password',
      username: config.saak,
      password: config.sask,
    }).toString(),
    {
      auth: { username: config.clientId, password: config.clientSecret },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  );

  console.log('[ION Auth] Réponse OAuth brute :', JSON.stringify(data, null, 2));

  if (!data.access_token) {
    throw new Error(
      `OAuth : access_token absent dans la réponse. Réponse reçue : ${JSON.stringify(data)}` 
    );
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };

  console.log(`[ION Auth] Nouveau token obtenu — expire dans ${data.expires_in ?? '?'}s`);
  return tokenCache.accessToken;
}

/**
 * Retourne l'URL de base ION API depuis la configuration UI.
 */
export async function getIonBaseUrl(): Promise<string> {
  const config = await getIonConfig();
  if (!config.baseUrl) {
    throw new Error('URL de base ION API non configurée.');
  }
  return config.baseUrl;
}

/**
 * Invalide le cache du token (utile pour forcer un renouvellement).
 */
export function invalidateTokenCache(): void {
  tokenCache = null;
}
