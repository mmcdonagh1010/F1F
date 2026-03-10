import jwt from "jsonwebtoken";
import { config } from "../config.js";

function getCookieValue(cookieHeader, name) {
  const prefix = `${name}=`;
  return String(cookieHeader || "")
    .split(/;\s*/)
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length) || "";
}

export function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : "";
  const cookieToken = getCookieValue(req.headers.cookie, config.authCookieName);
  const token = bearerToken || cookieToken;

  if (!token) {
    return res.status(401).json({ error: "Missing auth token" });
  }

  try {
    req.user = jwt.verify(token, config.jwtSecret);
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function adminRequired(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  return next();
}
