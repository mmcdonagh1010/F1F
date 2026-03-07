const TOKEN_KEY = "f1f_token";
const USER_KEY = "f1f_user";
const SESSION_EXPIRES_AT_KEY = "f1f_session_expires_at";

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_WARNING_MS = 60 * 1000;

function decodeTokenPayload(token) {
  if (typeof window === "undefined" || !token) return null;

  try {
    const [, payload = ""] = String(token).split(".");
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = window.atob(padded);
    const json = decodeURIComponent(
      Array.from(decoded)
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join("")
    );

    return JSON.parse(json);
  } catch {
    return null;
  }
}

function buildUserFromToken(token) {
  const payload = decodeTokenPayload(token);
  if (!payload || !payload.id || !payload.role) return null;

  return {
    id: String(payload.id),
    name: String(payload.name || "").trim(),
    email: String(payload.email || "").trim(),
    role: String(payload.role || "player").trim() || "player"
  };
}

function getCookieValue(name) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : "";
}

function setCookieValue(name, value) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=2592000; samesite=lax`;
}

function clearCookieValue(name) {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
}

function readStorageValue(key) {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) || sessionStorage.getItem(key) || getCookieValue(key) || "";
}

function writeStorageValue(key, value) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, value);
  sessionStorage.setItem(key, value);
  setCookieValue(key, value);
}

function removeStoredAuthKeys() {
  sessionStorage.removeItem(SESSION_EXPIRES_AT_KEY);
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  localStorage.removeItem(SESSION_EXPIRES_AT_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearCookieValue(SESSION_EXPIRES_AT_KEY);
  clearCookieValue(TOKEN_KEY);
  clearCookieValue(USER_KEY);
}

function getStoredExpiryAt() {
  const rawValue = readStorageValue(SESSION_EXPIRES_AT_KEY);
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeStoredExpiryAt(expiresAt) {
  writeStorageValue(SESSION_EXPIRES_AT_KEY, String(expiresAt));
}

export function refreshAuthSessionExpiry() {
  if (typeof window === "undefined") return 0;
  const token = readStorageValue(TOKEN_KEY);
  const rawUser = readStorageValue(USER_KEY);
  if (!token || !rawUser) return 0;

  const expiresAt = Date.now() + SESSION_TIMEOUT_MS;
  writeStoredExpiryAt(expiresAt);
  return expiresAt;
}

export function getAuthSessionExpiry() {
  if (typeof window === "undefined") return 0;
  return getStoredExpiryAt();
}

export function isAuthSessionExpired() {
  const expiresAt = getAuthSessionExpiry();
  return expiresAt > 0 && expiresAt <= Date.now();
}

export function getStoredToken() {
  if (typeof window === "undefined") return null;
  const token = readStorageValue(TOKEN_KEY);
  const rawUser = readStorageValue(USER_KEY);

  if (!token && rawUser) {
    removeStoredAuthKeys();
    return null;
  }

  if (token && isAuthSessionExpired()) {
    removeStoredAuthKeys();
    return null;
  }

  if (token) {
    writeStorageValue(TOKEN_KEY, token);
  }

  return token;
}

export function getStoredUser() {
  if (typeof window === "undefined") return null;
  const token = getStoredToken();
  if (!token) return null;

  const raw = readStorageValue(USER_KEY);
  if (!raw) {
    const userFromToken = buildUserFromToken(token);
    if (!userFromToken) return null;
    writeStorageValue(USER_KEY, JSON.stringify(userFromToken));
    return userFromToken;
  }

  try {
    const parsed = JSON.parse(raw);
    writeStorageValue(USER_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    const userFromToken = buildUserFromToken(token);
    if (!userFromToken) {
      removeStoredAuthKeys();
      return null;
    }
    writeStorageValue(USER_KEY, JSON.stringify(userFromToken));
    return userFromToken;
  }
}

export function storeAuthSession(token, user) {
  if (typeof window === "undefined") return;
  writeStorageValue(TOKEN_KEY, token);
  writeStorageValue(USER_KEY, JSON.stringify(user));
  refreshAuthSessionExpiry();
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;
  removeStoredAuthKeys();
}
