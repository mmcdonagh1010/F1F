import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import authRoutes from "./routes/auth.js";
import raceRoutes from "./routes/races.js";
import pickRoutes from "./routes/picks.js";
import leaderboardRoutes from "./routes/leaderboard.js";
import adminRoutes from "./routes/admin.js";
import notificationRoutes from "./routes/notifications.js";
import leagueRoutes from "./routes/leagues.js";
import f1Routes from "./routes/f1.js";
import { startJolpicaAutoSyncJob } from "./jobs/jolpicaAutoSync.js";

const app = express();

app.use(helmet());
const allowedOrigins = new Set(config.corsAllowedOrigins || []);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      const normalizedOrigin = String(origin).replace(/\/$/, "");
      if (allowedOrigins.has(normalizedOrigin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not allowed by Access-Control-Allow-Origin`));
    },
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/races", raceRoutes);
app.use("/api/picks", pickRoutes);
app.use("/api/leaderboard", leaderboardRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/leagues", leagueRoutes);
app.use("/api/f1", f1Routes);

app.use((err, _req, res, _next) => {
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
});

app.listen(config.port, () => {
  console.log(`Backend listening on port ${config.port}`);
  startJolpicaAutoSyncJob();
});
