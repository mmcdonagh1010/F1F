import dotenv from "dotenv";

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || "development",
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || "dev_secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:3000",
  bootstrapAdminKey: process.env.BOOTSTRAP_ADMIN_KEY || "",
  pickLockMinutesBeforeDeadline: Number(process.env.PICK_LOCK_MINUTES_BEFORE_DEADLINE || 30)
};
