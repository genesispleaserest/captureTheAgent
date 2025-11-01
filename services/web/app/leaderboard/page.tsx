"use client";

import { useEffect, useMemo, useState } from "react";

type LeaderboardResponse = {
  stats: {
    total?: number;
    confirmed?: number;
    pending?: number;
  };
  recent_kills?: Array<{
    verdict_id: string;
    claim_id: string;
    session_id: string;
    severity: string;
    created_at: number;
    regression_path: string | null;
    regression_url: string | null;
    user_id?: string | null;
    user_avatar?: string | null;
  }>;
};

// Prefer same-origin proxy to avoid mixed content / CORS issues.
// next.config rewrites '/api/*' to the actual API base.
const LEADERBOARD_ENDPOINT = `/api/leaderboard`;

export default function LeaderboardPage() {
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(LEADERBOARD_ENDPOINT, {
          method: "GET",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            // Avoid ngrok interstitial page that returns HTML instead of JSON
            "ngrok-skip-browser-warning": "true",
          },
        });

        if (!res.ok) {
          throw new Error(`Failed to load leaderboard (${res.status})`);
        }

        const payload: LeaderboardResponse = await res.json();
        setData(payload);
      } catch (fetchError) {
        if ((fetchError as Error).name !== "AbortError") {
          setError((fetchError as Error).message);
        }
      } finally {
        setLoading(false);
      }
    }

    void load();

    const interval = setInterval(() => {
      void load();
    }, 15000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, []);

  const stats = useMemo(
    () => ({
      total: data?.stats?.total ?? 0,
      confirmed: data?.stats?.confirmed ?? 0,
      pending: data?.stats?.pending ?? 0,
    }),
    [data]
  );

  const recentKills = data?.recent_kills ?? [];

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-[0.35em] text-slate-500">Referee Arena</p>
        <h1 className="text-4xl font-semibold tracking-tight text-white">Live Leaderboard</h1>
        <p className="max-w-2xl text-sm text-slate-300">
          Snapshot of claims and verified kills reproduced by the referee. Data refreshes every 15 seconds.
        </p>
      </header>

      {loading && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6">
          <p className="text-sm text-slate-300">Loading leaderboard...</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-rose-700/40 bg-rose-900/20 p-6">
          <p className="font-medium text-rose-200">Failed to load leaderboard</p>
          <p className="text-sm text-rose-300/80">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <section className="grid gap-4 md:grid-cols-3">
          <StatCard label="Total Claims" value={stats.total} accent="bg-sky-500/20 text-sky-300" />
          <StatCard label="Confirmed" value={stats.confirmed} accent="bg-emerald-500/20 text-emerald-300" />
          <StatCard label="Pending" value={stats.pending} accent="bg-amber-500/20 text-amber-200" />
        </section>
      )}

      {!loading && !error && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium text-white">Recent Kills</h2>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              Refresh
            </button>
          </div>

          {recentKills.length === 0 ? (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-300">
              No confirmed kills yet. Submit a claim to test the arena.
            </div>
          ) : (
            <ul className="space-y-3">
              {recentKills.map((kill) => (
                <li
                  key={kill.verdict_id}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 transition hover:border-slate-600"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="space-y-1">
                      {kill.user_avatar && (
                        <img src={kill.user_avatar} alt="avatar" className="h-7 w-7 rounded" />
                      )}
                      <p className="text-sm font-medium text-white">
                        Claim <span className="text-slate-300">{kill.claim_id}</span>
                      </p>
                      <p className="text-xs text-slate-400">
                        Session <span className="text-slate-200">{kill.session_id}</span>
                      </p>
                      <p className="text-xs text-slate-500">{formatTimestamp(kill.created_at)}</p>
                    </div>
                    <div className="flex flex-col items-start gap-3 md:items-end">
                      <span
                        className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${severityTone(kill.severity)}`}
                      >
                        {kill.severity || "Unknown"}
                      </span>
                      {kill.regression_url ? (
                        <a
                          href={kill.regression_url}
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-300 hover:text-sky-200"
                        >
                          Download regression pack
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="h-4 w-4"
                          >
                            <path d="M9 3a1 1 0 1 1 2 0v7.586l1.293-1.293a1 1 0 1 1 1.414 1.414l-3.25 3.25a.97.97 0 0 1-.173.13.997.997 0 0 1-1.268-.13l-3.25-3.25A1 1 0 0 1 6.707 9.293L8 10.586V3a1 1 0 0 1 1-1Z" />
                            <path d="M3 12a1 1 0 0 1 1 1v2h12v-2a1 1 0 1 1 2 0v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z" />
                          </svg>
                        </a>
                      ) : (
                        <span className="text-xs text-slate-500">No regression pack</span>
                      )}
                      <a
                        href={`/verdict/${kill.verdict_id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white"
                      >
                        View details
                      </a>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-sm">
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-4 text-4xl font-semibold text-white">{value}</p>
      <span className={`mt-4 inline-flex rounded-full px-3 py-1 text-xs font-medium ${accent}`}>{label}</span>
    </div>
  );
}

function formatTimestamp(timestamp: number | null | undefined): string {
  if (!timestamp) return "Unknown";
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function severityTone(severity: string | null | undefined): string {
  switch ((severity || "").toUpperCase()) {
    case "CRITICAL":
      return "bg-rose-500/20 text-rose-300 border border-rose-500/40";
    case "HIGH":
      return "bg-orange-500/20 text-orange-200 border border-orange-500/40";
    case "MEDIUM":
      return "bg-amber-500/20 text-amber-200 border border-amber-500/40";
    case "LOW":
      return "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40";
    default:
      return "bg-slate-700/40 text-slate-300 border border-slate-600/40";
  }
}

