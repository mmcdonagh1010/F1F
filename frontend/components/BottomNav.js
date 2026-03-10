"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAuthSession, getStoredUser } from "../lib/auth";
import { logoutApiSession } from "../lib/api";

const items = [
  { href: "/dashboard", label: "Predictions" },
  { href: "/live", label: "Live F1" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/admin", label: "Admin", adminOnly: true }
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [role, setRole] = useState(null);

  useEffect(() => {
    setRole(getStoredUser()?.role || "player");
  }, []);

  async function logout() {
    await logoutApiSession();
    clearAuthSession();
    router.push("/login");
  }

  const visibleItems = items.filter((item) => !item.adminOnly || role === "admin");

  return (
    <nav className="fixed bottom-3 left-1/2 z-50 flex w-[95%] -translate-x-1/2 items-center justify-between rounded-2xl border border-white/20 bg-track-800/85 px-3 py-2 backdrop-blur">
      {visibleItems.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`tap flex-1 rounded-xl px-2 py-2 text-center text-sm font-semibold ${
              active ? "bg-accent-red text-white" : "text-slate-300"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={logout}
        className="tap ml-2 rounded-xl border border-white/30 px-3 py-2 text-sm font-semibold text-slate-200"
      >
        Logout
      </button>
    </nav>
  );
}
