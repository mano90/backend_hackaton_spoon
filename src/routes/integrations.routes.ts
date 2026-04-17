import { Router, Request, Response } from 'express';
import * as salesforce from '../services/salesforce.service';
import { syncFromSalesforce } from '../services/salesforce-sync.service';

const router = Router();

router.get('/salesforce/status', async (_req: Request, res: Response) => {
  try {
    const status = await salesforce.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/salesforce/connect', async (req: Request, res: Response) => {
  try {
    const session = await salesforce.connect(req.body);
    res.json({
      success: true,
      session: {
        username: session.username,
        instanceUrl: session.instanceUrl,
        env: session.env,
        issuedAt: session.issuedAt,
      },
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/salesforce/disconnect', async (_req: Request, res: Response) => {
  try {
    await salesforce.disconnect();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/salesforce/sobjects', async (_req: Request, res: Response) => {
  try {
    const result = await salesforce.listSObjects();
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/salesforce/sync', async (req: Request, res: Response) => {
  try {
    const { dateFrom, dateTo, includeEmails } = req.body ?? {};
    const result = await syncFromSalesforce({
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      includeEmails: !!includeEmails,
    });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/salesforce', async (_req: Request, res: Response) => {
  try {
    await salesforce.clearCredentials();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
