"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearAuthSession } from "../lib/auth";

const items = [
  { href: "/dashboard", label: "Races" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/admin", label: "Admin" }
];

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  function logout() {
    clearAuthSession();
    router.push("/login");
  }

  return (
    <nav className="fixed bottom-3 left-1/2 z-50 flex w-[95%] -translate-x-1/2 items-center justify-between rounded-2xl border border-white/20 bg-track-800/85 px-3 py-2 backdrop-blur">
      {items.map((item) => {
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
