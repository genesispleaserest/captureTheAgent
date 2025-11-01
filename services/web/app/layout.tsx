"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";
import { useEffect, useState } from "react";

function UserBadge() {
  const [user, setUser] = useState<{ id: string; email: string | null; avatar: string } | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/me`, { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "true" } });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setUser(data.user);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);
  return (
    <div className="flex items-center gap-2">
      {user ? (
        <>
          <img src={user.avatar} alt="avatar" className="h-7 w-7 rounded" />
          <span className="text-xs text-slate-300">{user.email ?? 'Signed in'}</span>
          <button
            disabled={signingOut}
            onClick={async () => {
              try {
                setSigningOut(true);
                await fetch('/api/signout', { method: 'POST' });
                setUser(null);
                window.location.href = '/';
              } finally {
                setSigningOut(false);
              }
            }}
            className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50"
          >
            Sign out
          </button>
        </>
      ) : null}
    </div>
  );
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
            <Link href="/" className="inline-flex items-center gap-2">
              <img
                src="/sentient-logo.svg"
                alt="Sentient"
                width={28}
                height={28}
                className="rounded"
              />
              <span className="text-sm font-semibold tracking-wide text-slate-100">Sentient Arena</span>
            </Link>
            <nav className="flex items-center gap-3">
              <Link href="/try" className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-200 hover:border-slate-500">Try It</Link>
              <Link href="/leaderboard" className="rounded-md bg-sky-600 px-3 py-1.5 text-white hover:bg-sky-500">Leaderboard</Link>
            </nav>
            <UserBadge />
          </div>
        </header>
        <div className="pt-2">{children}</div>
      </body>
    </html>
  );
}
