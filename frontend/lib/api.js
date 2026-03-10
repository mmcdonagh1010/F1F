import { clearAuthSession, getStoredToken } from "./auth";

const isDebug = process.env.NEXT_PUBLIC_DEBUG === "true" || process.env.NODE_ENV !== "production";
export const API_BASE = isDebug
  ? process.env.NEXT_PUBLIC_API_BASE_DEBUG || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000/api"
  : process.env.NEXT_PUBLIC_API_BASE_PROD || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000/api";

export async function publicApiFetch(path, options = {}) {
  const token = getStoredToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store"
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({ error: "Request failed" }));
    const error = new Error(payload.error || "Request failed");
    error.data = payload;
    throw error;
  }

  return res.json();
}

export async function apiFetch(path, options = {}) {
  const token = getStoredToken();
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store"
  });

  if (!res.ok) {
    if (res.status === 401) {
      clearAuthSession();
      if (typeof window !== "undefined") {
        const authRoutes = new Set(["/login", "/register"]);
        if (!authRoutes.has(window.location.pathname)) {
          window.location.href = "/login";
        }
      }
    }
    const payload = await res.json().catch(() => ({ error: "Request failed" }));
    const error = new Error(payload.error || "Request failed");
    error.data = payload;
    throw error;
  }

  return res.json();
}

export async function logoutApiSession() {
  try {
    await publicApiFetch("/auth/logout", { method: "POST" });
  } catch {
    // Clearing local auth state is sufficient if the server is already logged out.
  }
}
