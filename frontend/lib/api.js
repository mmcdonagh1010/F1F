import { clearAuthSession, getStoredToken } from "./auth";

const isDebug = process.env.NEXT_PUBLIC_DEBUG === "true" || process.env.NODE_ENV !== "production";
const API_BASE = isDebug
  ? process.env.NEXT_PUBLIC_API_BASE_DEBUG || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000/api"
  : process.env.NEXT_PUBLIC_API_BASE_PROD || process.env.NEXT_PUBLIC_API_BASE || "http://localhost:4000/api";

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
    throw new Error(payload.error || "Request failed");
  }

  return res.json();
}
