import { Router, Request, Response } from 'express';
import { fetchAllTimelineEvents, fetchScenarioTimelineEvents } from '../services/timeline-data.service';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const events = await fetchAllTimelineEvents();
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/scenario/:scenarioId', async (req: Request, res: Response) => {
  try {
    const raw = req.params.scenarioId;
    const scenarioId = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    const events = await fetchScenarioTimelineEvents(scenarioId);
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
