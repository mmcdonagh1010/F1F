import rateLimit from "express-rate-limit";

export function buildRateLimiter({
  windowMs,
  max,
  message,
  skipSuccessfulRequests = false
}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    message: { error: message }
  });
}