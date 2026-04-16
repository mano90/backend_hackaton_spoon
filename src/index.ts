import { createServer } from "http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import emailRoutes from "./routes/email.routes";
import authRoutes from "./routes/auth.routes";
import mouvementRoutes from "./routes/mouvement.routes";
import rapprochementRoutes from "./routes/rapprochement.routes";
import queryRoutes from "./routes/query.routes";
import statsRoutes from "./routes/stats.routes";
import documentsRoutes from "./routes/documents.routes";
import timelineRoutes from "./routes/timeline.routes";
import configRoutes from "./routes/config.routes";
import m3Routes from "./routes/m3.routes";
import ionConfigRoutes from "./routes/ion-config.routes";
import { attachRealtime } from "./services/realtime-import.service";
import { requireAuth } from "./middleware/auth.middleware";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: "http://localhost:4200",
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

// Public
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);

// All other /api/* routes require Bearer JWT
app.use("/api", requireAuth);

app.use("/api/documents", documentsRoutes);
app.use("/api/mouvements", mouvementRoutes);
app.use("/api/rapprochement", rapprochementRoutes);
app.use("/api/query", queryRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/timeline", timelineRoutes);
app.use("/api/config", configRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/m3", m3Routes);
app.use("/api/ion-config", ionConfigRoutes);

const httpServer = createServer(app);
attachRealtime(httpServer);

httpServer.listen(PORT, async () => {
  console.log(`[Server] Running on http://localhost:${PORT}`);

  try {
    const { seed } = await import("./seed");
    await seed();
  } catch (err) {
    console.error("[Seed] Failed:", err);
  }
});
