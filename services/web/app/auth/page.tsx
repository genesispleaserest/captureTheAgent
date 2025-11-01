"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

export default function AuthPage() {
  const search = useSearchParams();
  const nextParam = search?.get('next') || '/';
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [magicLink, setMagicLink] = useState<string | null>(null);

  async function signup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ email, next: nextParam })
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      const data = await res.json();
      setMsg(data.message || "Magic link sent. Check your email.");
      setUserId(data.user_id || null);
      if (data.magic_link) setMagicLink(data.magic_link);
    } catch (e: any) {
      setErr(e.message);
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-14 space-y-8">
      <header className="text-center space-y-2">
        <h1 className="text-3xl font-semibold text-white">Sign up / Sign in</h1>
        <p className="text-slate-300">Enter your email to receive a one‑time magic link. No password required.</p>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 space-y-4">
        <form onSubmit={signup} className="flex gap-2">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-slate-600"
          />
          <button disabled={busy} className="rounded-md bg-emerald-700 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Sending…' : 'Send Link'}</button>
        </form>
        {msg && (<p className="text-sm text-emerald-300">{msg}</p>)}
        {magicLink && (
          <div className="inline-flex items-center gap-2 rounded border border-slate-800 bg-slate-900/50 px-3 py-2">
            <a href={magicLink} className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs text-white hover:bg-emerald-600">Click to sign in</a>
            <span className="text-xs text-slate-400">Dev helper — link also sent via email if SMTP is configured.</span>
          </div>
        )}
        {userId && (
          <div className="flex items-center gap-3">
            <img src={`/api/users/${userId}/avatar.png`} alt="avatar" className="h-10 w-10 rounded" />
            <span className="text-slate-300 text-sm">Your avatar will appear on leaderboards.</span>
          </div>
        )}
        {err && (<p className="text-sm text-rose-300">{err}</p>)}
        <p className="text-xs text-slate-500">By continuing, you agree to receive a one-time email to sign in.</p>
      </section>
    </main>
  );
}
