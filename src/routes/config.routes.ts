import { Router, Request, Response } from 'express';
import { getConfig, saveConfig, DEFAULT_CONFIG } from '../services/config.service';
import { getFraudConfig, saveFraudConfig, DEFAULT_FRAUD_CONFIG } from '../services/fraud-config.service';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const config = await getConfig();
    const fraudConfig = await getFraudConfig();
    res.json({
      config,
      fraudConfig,
      defaults: { rapprochement: DEFAULT_CONFIG, fraud: DEFAULT_FRAUD_CONFIG },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/fraud', async (_req: Request, res: Response) => {
  try {
    const fraudConfig = await getFraudConfig();
    res.json({ fraudConfig, defaults: DEFAULT_FRAUD_CONFIG });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/fraud', async (req: Request, res: Response) => {
  try {
    const updated = await saveFraudConfig(req.body || {});
    res.json({ success: true, fraudConfig: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    let fraudConfig = await getFraudConfig();
    if (body.fraud && typeof body.fraud === 'object') {
      fraudConfig = await saveFraudConfig(body.fraud);
    }
    const rapBody = { ...body };
    delete (rapBody as { fraud?: unknown }).fraud;
    const updated = await saveConfig(rapBody);
    res.json({ success: true, config: updated, fraudConfig });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset', async (_req: Request, res: Response) => {
  try {
    const reset = await saveConfig(DEFAULT_CONFIG);
    const fraudReset = await saveFraudConfig(DEFAULT_FRAUD_CONFIG);
    res.json({ success: true, config: reset, fraudConfig: fraudReset });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
