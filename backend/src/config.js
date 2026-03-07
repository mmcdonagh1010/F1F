import dotenv from "dotenv";

dotenv.config();

function normalizeJwtExpiresIn(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "7d";

  // jsonwebtoken treats a bare numeric string as milliseconds; treat it as seconds instead.
  if (/^\d+$/.test(normalized)) {
    return Number(normalized);
  }

  return normalized;
}

function normalizeOrigin(value) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return normalized.replace(/\/$/, "");
}

function parseOriginList(...values) {
  return Array.from(
    new Set(
      values
        .flatMap((value) => String(value || "").split(","))
        .map((value) => normalizeOrigin(value))
        .filter(Boolean)
    )
  );
}

const port = Number(process.env.PORT || 4000);
const nodeEnv = process.env.NODE_ENV || "production";
const debug = process.env.DEBUG === "true" || nodeEnv !== "production";

const defaultFrontendUrlDebug = "http://localhost:3000";
const defaultFrontendUrlProd = "https://teal-ganache-11922e.netlify.app";

const frontendUrlDebug = normalizeOrigin(
  process.env.FRONTEND_URL_DEBUG || process.env.FRONTEND_URL || defaultFrontendUrlDebug
);
const frontendUrlProd = normalizeOrigin(
  process.env.FRONTEND_URL_PROD || process.env.FRONTEND_URL_PRODUCTION || defaultFrontendUrlProd
);
const corsAllowedOrigins = parseOriginList(
  process.env.CORS_ALLOWED_ORIGINS,
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_DEBUG,
  process.env.FRONTEND_URL_PROD,
  process.env.FRONTEND_URL_PRODUCTION,
  defaultFrontendUrlDebug,
  "http://127.0.0.1:3000",
  "http://localhost:3002",
  "http://127.0.0.1:3002",
  defaultFrontendUrlProd
);

const backendUrlDebug = process.env.BACKEND_URL_DEBUG || `http://localhost:${port}`;
const backendUrlProd = process.env.BACKEND_URL_PROD || process.env.BACKEND_URL || backendUrlDebug;

export const config = {
  port,
  nodeEnv,
  debug,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "dev_secret",
  jwtExpiresIn: normalizeJwtExpiresIn(process.env.JWT_EXPIRES_IN),
  mongodbUri: process.env.MONGODB_URI || process.env.MONGO_URI || "",
  frontendUrlDebug,
  frontendUrlProduction: frontendUrlProd,
  corsAllowedOrigins,
  backendUrlDebug,
  backendUrlProduction: backendUrlProd,
  frontendUrl: debug ? frontendUrlDebug : frontendUrlProd,
  backendUrl: debug ? backendUrlDebug : backendUrlProd,
  bootstrapAdminKey: process.env.BOOTSTRAP_ADMIN_KEY || "",
  pickLockMinutesBeforeDeadline: Number(process.env.PICK_LOCK_MINUTES_BEFORE_DEADLINE || 30),
  jolpicaAutoSyncEnabled: process.env.JOLPICA_AUTO_SYNC_ENABLED !== "false",
  jolpicaAutoSyncIntervalMs: Math.max(60_000, Number(process.env.JOLPICA_AUTO_SYNC_INTERVAL_MS || 15 * 60 * 1000)),
  jolpicaAutoSyncSeason: Number(process.env.JOLPICA_AUTO_SYNC_SEASON || new Date().getUTCFullYear())
};
