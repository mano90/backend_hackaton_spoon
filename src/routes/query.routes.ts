import { Router, Request, Response } from 'express';
import { queryData } from '../agents/query.agent';

const router = Router();

// AI-powered query endpoint
router.post('/', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const result = await queryData(query);
    res.json(result);
  } catch (err: any) {
    console.error('Query error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
