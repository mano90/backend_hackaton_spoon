import { Router, Request, Response } from 'express';
import { analyzeEmail } from '../agents/email-classifier.agent';

const router = Router();

// POST /api/emails/analyze
router.post('/analyze', async (req: Request, res: Response): Promise<void> => {
  try {
    const { emailId, content, threadId } = req.body;

    if (!content || !emailId) {
      res.status(400).json({ error: 'Missing required fields: emailId and content are required.' });
      return;
    }

    const analysisResult = await analyzeEmail(content, emailId, threadId);
    res.json(analysisResult);
  } catch (error) {
    console.error('[Email Route] Error analyzing email:', error);
    res.status(500).json({ error: 'An error occurred while analyzing the email.' });
  }
});

export default router;
