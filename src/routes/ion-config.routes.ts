import { Router, Request, Response } from 'express';
import axios from 'axios';
import { getIonConfig, saveIonConfig, isConfigured, IonConfig } from '../services/ion-config.service';
import { invalidateTokenCache } from '../services/ion-auth.service';

const router = Router();

/** GET /api/ion-config — retourne la config actuelle (clientSecret masqué) */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const config = await getIonConfig();
    res.json({
      config: {
        ...config,
        clientSecret: config.clientSecret ? '••••••••' : '',
        sask: config.sask ? '••••••••' : '',
      },
      configured: isConfigured(config),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/ion-config — sauvegarde la config (clientSecret vide = conserver l'ancien) */
router.put('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<IonConfig>;

    const current = await getIonConfig();

    // Préserver les secrets si le masque est renvoyé
    if (!body.clientSecret || body.clientSecret === '••••••••') {
      body.clientSecret = current.clientSecret;
    }
    if (!body.sask || body.sask === '••••••••') {
      body.sask = current.sask;
    }

    const updated = await saveIonConfig(body);
    invalidateTokenCache(); // Invalider le token en cache si les credentials changent

    res.json({
      success: true,
      config: {
        ...updated,
        clientSecret: updated.clientSecret ? '••••••••' : '',
        sask: updated.sask ? '••••••••' : '',
      },
      configured: isConfigured(updated),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/ion-config/test — teste la connexion OAuth et retourne les infos du token */
router.post('/test', async (_req: Request, res: Response) => {
  try {
    const config = await getIonConfig();
    if (!isConfigured(config)) {
      res.status(400).json({ success: false, error: 'Configuration incomplète. Renseignez tous les champs.' });
      return;
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
        timeout: 10000,
      }
    );

    // Succès : invalider le cache pour que le nouveau token soit utilisé
    invalidateTokenCache();

    res.json({
      success: true,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
      scope: data.scope ?? null,
    });
  } catch (err: any) {
    const detail = err.response?.data ?? null;
    const status = err.response?.status ?? null;
    res.status(200).json({
      success: false,
      error: err.message,
      httpStatus: status,
      detail,
    });
  }
});

export default router;
