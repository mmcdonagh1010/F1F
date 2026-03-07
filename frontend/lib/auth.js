const TOKEN_KEY = "f1f_token";
const USER_KEY = "f1f_user";

function removeStoredAuthKeys() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredToken() {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem(TOKEN_KEY);
  const rawUser = localStorage.getItem(USER_KEY);

  if (!token && rawUser) {
    removeStoredAuthKeys();
    return null;
  }

  return token;
}

export function getStoredUser() {
  if (typeof window === "undefined") return null;
  const token = getStoredToken();
  if (!token) return null;

  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    removeStoredAuthKeys();
    return null;
  }
}

export function storeAuthSession(token, user) {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;
  removeStoredAuthKeys();
}
