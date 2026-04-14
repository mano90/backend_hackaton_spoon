import redis from './redis.service';

const CREDS_KEY = 'integrations:salesforce:credentials';
const SESSION_KEY = 'integrations:salesforce:session';
const API_VERSION = 'v60.0';

export type SalesforceEnv = 'sandbox' | 'production';

export interface SalesforceConnectInput {
  env?: SalesforceEnv;
  loginUrl?: string;
}

export interface SalesforceSession {
  accessToken: string;
  instanceUrl: string;
  issuedAt: string;
  tokenType?: string;
  username?: string;
  env: SalesforceEnv;
}

export interface SalesforceStatus {
  connected: boolean;
  username?: string;
  env?: SalesforceEnv;
  instanceUrl?: string;
  issuedAt?: string;
  hasCredentials: boolean;
  envDefaults: {
    hasClientId: boolean;
    hasClientSecret: boolean;
    loginUrl: string;
    env: SalesforceEnv;
  };
}

export interface SalesforceSObject {
  name: string;
  label: string;
  labelPlural?: string;
  custom: boolean;
  queryable: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  keyPrefix?: string | null;
  urls?: Record<string, string>;
}

function defaultLoginHost(env: SalesforceEnv): string {
  return env === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com';
}

function resolveLoginHost(env: SalesforceEnv, loginUrl?: string): string {
  if (loginUrl && /^https?:\/\//i.test(loginUrl)) return loginUrl.replace(/\/$/, '');
  return defaultLoginHost(env);
}

function envDefaults() {
  const env: SalesforceEnv = process.env.SF_ENV === 'production' ? 'production' : 'sandbox';
  return {
    clientId: process.env.SF_CLIENT_ID ?? '',
    clientSecret: process.env.SF_CLIENT_SECRET ?? '',
    loginUrl: process.env.SF_LOGIN_URL ?? '',
    env,
  };
}

export async function getStatus(): Promise<SalesforceStatus> {
  const [rawCreds, rawSession] = await Promise.all([
    redis.get(CREDS_KEY),
    redis.get(SESSION_KEY),
  ]);
  const e = envDefaults();
  const envDefaultsPublic = {
    hasClientId: !!e.clientId,
    hasClientSecret: !!e.clientSecret,
    loginUrl: e.loginUrl,
    env: e.env,
  };
  const hasCredentials = !!rawCreds;
  if (!rawSession) return { connected: false, hasCredentials, envDefaults: envDefaultsPublic };
  try {
    const s = JSON.parse(rawSession) as SalesforceSession;
    return {
      connected: true,
      username: s.username,
      env: s.env,
      instanceUrl: s.instanceUrl,
      issuedAt: s.issuedAt,
      hasCredentials,
      envDefaults: envDefaultsPublic,
    };
  } catch {
    return { connected: false, hasCredentials, envDefaults: envDefaultsPublic };
  }
}

export async function disconnect(): Promise<void> {
  await redis.del(SESSION_KEY);
}

export async function clearCredentials(): Promise<void> {
  await redis.del(CREDS_KEY);
  await redis.del(SESSION_KEY);
}

/**
 * OAuth 2.0 Client Credentials Flow (server-to-server).
 * Ne nécessite ni mot de passe ni security token — le Connected App Salesforce
 * doit être configuré avec "Enable Client Credentials Flow" + un "Run As" user.
 */
export async function connect(input: SalesforceConnectInput = {}): Promise<SalesforceSession> {
  const e = envDefaults();
  const env: SalesforceEnv = input.env === 'production' || input.env === 'sandbox' ? input.env : e.env;
  const loginUrl = (input.loginUrl ?? e.loginUrl).trim();
  const clientId = e.clientId;
  const clientSecret = e.clientSecret;

  if (!clientId || !clientSecret) {
    throw new Error(
      'SF_CLIENT_ID / SF_CLIENT_SECRET manquants dans le .env du backend.'
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const host = resolveLoginHost(env, loginUrl);
  const res = await fetch(`${host}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    const reason = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Échec authentification Salesforce : ${reason}`);
  }

  const session: SalesforceSession = {
    accessToken: data.access_token,
    instanceUrl: data.instance_url,
    tokenType: data.token_type,
    issuedAt: new Date().toISOString(),
    env,
  };

  // Récupère l'identité du "Run As" user (si le scope est disponible)
  try {
    const ui = await fetch(`${session.instanceUrl}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${session.accessToken}` },
    });
    if (ui.ok) {
      const uiData: any = await ui.json();
      session.username = uiData.preferred_username || uiData.email || uiData.name || undefined;
    }
  } catch {
    /* userinfo facultatif */
  }

  await redis.set(CREDS_KEY, JSON.stringify({ env, loginUrl, flow: 'client_credentials' }));
  await redis.set(SESSION_KEY, JSON.stringify(session));
  console.log(`[Salesforce] Connected (client_credentials) -> ${session.instanceUrl}`);
  return session;
}

export async function getSession(): Promise<SalesforceSession | null> {
  const raw = await redis.get(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SalesforceSession;
  } catch {
    return null;
  }
}

async function callApi<T>(path: string): Promise<T> {
  const session = await getSession();
  if (!session) throw new Error('Non connecté à Salesforce.');
  const url = `${session.instanceUrl}${path.startsWith('/') ? path : '/' + path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Salesforce API ${res.status} : ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function listSObjects(): Promise<{ total: number; objects: SalesforceSObject[] }> {
  const data = await callApi<{ sobjects: SalesforceSObject[] }>(
    `/services/data/${API_VERSION}/sobjects/`
  );
  const objects = (data.sobjects ?? []).map(o => ({
    name: o.name,
    label: o.label,
    labelPlural: o.labelPlural,
    custom: o.custom,
    queryable: o.queryable,
    createable: o.createable,
    updateable: o.updateable,
    deletable: o.deletable,
    keyPrefix: o.keyPrefix ?? null,
    urls: o.urls,
  }));
  return { total: objects.length, objects };
}
