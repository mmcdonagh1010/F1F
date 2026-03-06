export function getStoredToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("f1f_token");
}

export function getStoredUser() {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem("f1f_user");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function storeAuthSession(token, user) {
  if (typeof window === "undefined") return;
  localStorage.setItem("f1f_token", token);
  localStorage.setItem("f1f_user", JSON.stringify(user));
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem("f1f_token");
  localStorage.removeItem("f1f_user");
}
