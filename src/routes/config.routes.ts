import { Router, Request, Response } from 'express';
import { getConfig, saveConfig, DEFAULT_CONFIG } from '../services/config.service';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const config = await getConfig();
    res.json({ config, defaults: DEFAULT_CONFIG });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/', async (req: Request, res: Response) => {
  try {
    const updated = await saveConfig(req.body);
    res.json({ success: true, config: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset', async (_req: Request, res: Response) => {
  try {
    const reset = await saveConfig(DEFAULT_CONFIG);
    res.json({ success: true, config: reset });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
