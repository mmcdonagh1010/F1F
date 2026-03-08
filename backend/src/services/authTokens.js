import crypto from "crypto";
import { config } from "../config.js";

export function createRawToken() {
  return crypto.randomBytes(32).toString("hex");
}

export function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

export function buildFrontendAuthUrl(path, params = {}) {
  const base = new URL(config.frontendUrl);
  base.pathname = path;
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      base.searchParams.set(key, String(value));
    }
  });
  return base.toString();
}

export function buildDebugPreviewUrl(path, token) {
  if (!config.debug || !token) return null;
  return buildFrontendAuthUrl(path, { token });
}

export function buildFrontendTokenUrl(path, token) {
  if (!token) return null;
  return buildFrontendAuthUrl(path, { token });
}