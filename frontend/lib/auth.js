const TOKEN_KEY = "f1f_token";
const USER_KEY = "f1f_user";

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
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  clearCookieValue(TOKEN_KEY);
  clearCookieValue(USER_KEY);
}

export function getStoredToken() {
  if (typeof window === "undefined") return null;
  const token = readStorageValue(TOKEN_KEY);
  const rawUser = readStorageValue(USER_KEY);

  if (!token && rawUser) {
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
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    writeStorageValue(USER_KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    removeStoredAuthKeys();
    return null;
  }
}

export function storeAuthSession(token, user) {
  if (typeof window === "undefined") return;
  writeStorageValue(TOKEN_KEY, token);
  writeStorageValue(USER_KEY, JSON.stringify(user));
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;
  removeStoredAuthKeys();
}
