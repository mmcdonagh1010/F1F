import dotenv from "dotenv";

dotenv.config();

const port = Number(process.env.PORT || 4000);
const nodeEnv = process.env.NODE_ENV || "production";
const debug = process.env.DEBUG === "true" || nodeEnv !== "production";

const frontendUrlDebug = process.env.FRONTEND_URL_DEBUG || process.env.FRONTEND_URL || "http://localhost:3000";
const frontendUrlProd = process.env.FRONTEND_URL_PROD || process.env.FRONTEND_URL || frontendUrlDebug;

const backendUrlDebug = process.env.BACKEND_URL_DEBUG || `http://localhost:${port}`;
const backendUrlProd = process.env.BACKEND_URL_PROD || process.env.BACKEND_URL || backendUrlDebug;

export const config = {
  port,
  nodeEnv,
  debug,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "dev_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  frontendUrlDebug,
  frontendUrlProduction: frontendUrlProd,
  backendUrlDebug,
  backendUrlProduction: backendUrlProd,
  frontendUrl: debug ? frontendUrlDebug : frontendUrlProd,
  backendUrl: debug ? backendUrlDebug : backendUrlProd,
  bootstrapAdminKey: process.env.BOOTSTRAP_ADMIN_KEY || "",
  pickLockMinutesBeforeDeadline: Number(process.env.PICK_LOCK_MINUTES_BEFORE_DEADLINE || 30)
};
