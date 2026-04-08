import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import factureRoutes from './routes/facture.routes';
import mouvementRoutes from './routes/mouvement.routes';
import rapprochementRoutes from './routes/rapprochement.routes';
import queryRoutes from './routes/query.routes';
import statsRoutes from './routes/stats.routes';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: 'http://localhost:4200', credentials: true }));
app.use(express.json());

// Routes
app.use('/api/factures', factureRoutes);
app.use('/api/mouvements', mouvementRoutes);
app.use('/api/rapprochement', rapprochementRoutes);
app.use('/api/query', queryRoutes);
app.use('/api/stats', statsRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, async () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);

  // Test agent call
  try {
    const { callAgent } = await import('./agents/base.agent');
    const reply = await callAgent('You are a helpful assistant.', 'Say hello in one sentence.');
    console.log(`[Agent Test] ${reply}`);
  } catch (err) {
    console.error('[Agent Test] Failed:', err);
  }
});
