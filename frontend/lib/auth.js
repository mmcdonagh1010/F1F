const USER_KEY = "f1f_user";
const SESSION_EXPIRES_AT_KEY = "f1f_session_expires_at";
const SERVER_SESSION_EXPIRES_AT_KEY = "f1f_server_session_expires_at";

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
export const SESSION_WARNING_MS = 60 * 1000;

function readStorageValue(key) {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
}

function writeStorageValue(key, value) {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, value);
  sessionStorage.setItem(key, value);
}

function removeStoredAuthKeys() {
  sessionStorage.removeItem(SESSION_EXPIRES_AT_KEY);
  sessionStorage.removeItem(USER_KEY);
  sessionStorage.removeItem(SERVER_SESSION_EXPIRES_AT_KEY);
  localStorage.removeItem(SESSION_EXPIRES_AT_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SERVER_SESSION_EXPIRES_AT_KEY);
}

function getStoredExpiryAt() {
  const rawValue = readStorageValue(SESSION_EXPIRES_AT_KEY);
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeStoredExpiryAt(expiresAt) {
  writeStorageValue(SESSION_EXPIRES_AT_KEY, String(expiresAt));
}

function getStoredServerExpiryAt() {
  const rawValue = readStorageValue(SERVER_SESSION_EXPIRES_AT_KEY);
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : 0;
}

function writeStoredServerExpiryAt(expiresAt) {
  if (!expiresAt) {
    sessionStorage.removeItem(SERVER_SESSION_EXPIRES_AT_KEY);
    localStorage.removeItem(SERVER_SESSION_EXPIRES_AT_KEY);
    return;
  }

  writeStorageValue(SERVER_SESSION_EXPIRES_AT_KEY, String(expiresAt));
}

function resolveNextExpiryAt() {
  const serverExpiresAt = getStoredServerExpiryAt();
  const idleExpiresAt = Date.now() + SESSION_TIMEOUT_MS;
  const nextExpiry = serverExpiresAt > 0 ? Math.min(idleExpiresAt, serverExpiresAt) : idleExpiresAt;

  return nextExpiry > Date.now() ? nextExpiry : 0;
}

export function refreshAuthSessionExpiry() {
  if (typeof window === "undefined") return 0;
  const rawUser = readStorageValue(USER_KEY);
  if (!rawUser) return 0;

  const expiresAt = resolveNextExpiryAt();
  if (!expiresAt) {
    removeStoredAuthKeys();
    return 0;
  }

  writeStoredExpiryAt(expiresAt);
  return expiresAt;
}

export function getAuthSessionExpiry() {
  if (typeof window === "undefined") return 0;
  const expiresAt = getStoredExpiryAt();
  if (expiresAt > 0) return expiresAt;

  const rawUser = readStorageValue(USER_KEY);
  if (!rawUser) return 0;

  return refreshAuthSessionExpiry();
}

export function isAuthSessionExpired() {
  const expiresAt = getAuthSessionExpiry();
  return expiresAt > 0 && expiresAt <= Date.now();
}

export function hasStoredSession() {
  if (typeof window === "undefined") return null;
  const rawUser = readStorageValue(USER_KEY);

  if (!rawUser) return false;

  if (isAuthSessionExpired()) {
    removeStoredAuthKeys();
    return false;
  }

  return true;
}

export function getStoredUser() {
  if (typeof window === "undefined") return null;
  if (!hasStoredSession()) return null;

  const raw = readStorageValue(USER_KEY);

  try {
    const parsed = JSON.parse(raw);
    writeStorageValue(USER_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    removeStoredAuthKeys();
    return null;
  }
}

export function storeAuthSession(user, sessionExpiresAt = null) {
  if (typeof window === "undefined") return;
  writeStorageValue(USER_KEY, JSON.stringify(user));
  const parsedServerExpiry = sessionExpiresAt ? new Date(sessionExpiresAt).getTime() : 0;
  writeStoredServerExpiryAt(Number.isFinite(parsedServerExpiry) ? parsedServerExpiry : 0);
  refreshAuthSessionExpiry();
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;
  removeStoredAuthKeys();
}
