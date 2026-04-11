import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { queryData } from '../agents/query.agent';
import { getTurns, resetChat } from '../services/ai-chat.service';
import type { AIQueryHistoryResponse, AIQueryHistoryTurn } from '../types';

const router = Router();

router.get('/history/:sessionId', async (req: Request, res: Response) => {
  try {
    const sessionId = typeof req.params.sessionId === 'string' ? req.params.sessionId : req.params.sessionId?.[0];
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    const turnsRaw = await getTurns(sessionId);
    const turns: AIQueryHistoryTurn[] = turnsRaw.map((t) => ({
      question: t.question,
      answer: t.answer,
      sources: Array.isArray(t.sources) ? (t.sources as AIQueryHistoryTurn['sources']) : [],
      at: t.at,
      ...(Array.isArray(t.timelineEvents) && t.timelineEvents.length
        ? {
            timelineEvents: t.timelineEvents as Record<string, unknown>[],
            timelineMeta: t.timelineMeta,
          }
        : {}),
    }));
    const body: AIQueryHistoryResponse = { sessionId, turns };
    res.json(body);
  } catch (err: any) {
    console.error('Query history error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/reset', async (req: Request, res: Response) => {
  try {
    const sessionId = req.body?.sessionId as string | undefined;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }
    await resetChat(sessionId);
    res.status(204).send();
  } catch (err: any) {
    console.error('Query reset error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    let sessionId = req.body?.sessionId as string | undefined;
    if (!sessionId || typeof sessionId !== 'string') {
      sessionId = uuidv4();
    }

    const result = await queryData(sessionId, query.trim());
    res.json(result);
  } catch (err: any) {
    console.error('Query error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
