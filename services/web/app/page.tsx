"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto min-h-screen max-w-6xl px-6 py-16">
      {/* Hero */}
      <section className="text-center space-y-6">
        <h1 className="bg-gradient-to-r from-sky-400 via-fuchsia-400 to-emerald-300 bg-clip-text text-5xl font-extrabold text-transparent animate-pulse">
          Welcome to capture-the-agent
        </h1>
        <p className="mx-auto max-w-2xl text-slate-300">
          A live arena for policy stress‑testing and red‑team evaluation of AI agents.
        </p>
      </section>

      {/* Action Cards */}
      <section className="mt-14 grid gap-6 md:grid-cols-2">
        <Link href="/auth?next=/admin/agents" className="group rounded-2xl border border-slate-800 bg-slate-900/50 p-8 shadow-sm transition hover:border-slate-600 hover:bg-slate-900">
          <div className="flex items-start justify-between">
            <h2 className="text-2xl font-semibold text-white">Deploy an agent to the GRID</h2>
            <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">Builders</span>
          </div>
          <p className="mt-3 text-slate-300">Onboard your agent for testing. Configure policies and let the arena run challenges.</p>
          <div className="mt-6 inline-flex items-center gap-2 text-sky-300 group-hover:text-sky-200">
            Continue
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M10.75 3.75a.75.75 0 0 0-1.5 0v8.19L6.53 9.22a.75.75 0 0 0-1.06 1.06l4 4a.75.75 0 0 0 1.06 0l4-4a.75.75 0 1 0-1.06-1.06l-2.72 2.72V3.75Z"/></svg>
          </div>
        </Link>

        <Link href="/auth?next=/try" className="group rounded-2xl border border-slate-800 bg-slate-900/50 p-8 shadow-sm transition hover:border-slate-600 hover:bg-slate-900">
          <div className="flex items-start justify-between">
            <h2 className="text-2xl font-semibold text-white">Challenge an agent</h2>
            <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">Red Team</span>
          </div>
          <p className="mt-3 text-slate-300">Join the arena to craft attacks and submit claims. Watch the referee reproduce them live.</p>
          <div className="mt-6 inline-flex items-center gap-2 text-emerald-300 group-hover:text-emerald-200">
            Continue
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4"><path d="M10.75 3.75a.75.75 0 0 0-1.5 0v8.19L6.53 9.22a.75.75 0 0 0-1.06 1.06l4 4a.75.75 0 0 0 1.06 0l4-4a.75.75 0 1 0-1.06-1.06l-2.72 2.72V3.75Z"/></svg>
          </div>
        </Link>
      </section>

      {/* Secondary links */}
      <section className="mt-12 flex flex-wrap items-center justify-center gap-4">
        <Link href="/leaderboard" className="rounded-md border border-slate-700 px-4 py-2 text-slate-100 hover:border-slate-500">View Leaderboard</Link>
        <Link href="/try" className="rounded-md border border-slate-700 px-4 py-2 text-slate-100 hover:border-slate-500">Explore Demo</Link>
      </section>
    </main>
  );
}
