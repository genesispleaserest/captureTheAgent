"use client";

import { useEffect, useState } from "react";

type Verdict = {
  verdict_id: string;
  claim_id: string;
  reproduced: boolean;
  severity: string;
  regression_path: string | null;
  created_at: number;
  claim_status: string;
  detectors_version: string | null;
  env_hash: string | null;
  evidence: { canary?: string[]; jailbreak?: string[]; spendCap?: string[]; totalSpendUSD?: number } | null;
  transcript_hits: Array<{ index: number; role: string; content_masked: string }>;
};

export default function VerdictPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<Verdict | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/claims/${params.id}/verdict`, {
          headers: { Accept: "application/json", "ngrok-skip-browser-warning": "true" },
          signal: ctrl.signal
        });
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        setData(await res.json());
      } catch (e: any) {
        if (e.name !== "AbortError") setError(e.message);
      }
    })();
    return () => ctrl.abort();
  }, [params.id]);

  if (error) return <main className="mx-auto max-w-3xl px-6 py-12"><p className="text-rose-300">{error}</p></main>;
  if (!data) return <main className="mx-auto max-w-3xl px-6 py-12"><p className="text-slate-300">Loading…</p></main>;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-white">Verdict {data.verdict_id}</h1>
        <p className="text-slate-400 text-sm">Claim {data.claim_id} · Severity {data.severity} · Reproduced {String(data.reproduced)}</p>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-white font-medium">Detector Versions & Environment</h2>
        <div className="mt-2 text-sm text-slate-300 space-y-1">
          <p><span className="text-slate-400">Detectors:</span> {data.detectors_version ?? "unknown"}</p>
          <p><span className="text-slate-400">Env Hash:</span> {data.env_hash ?? "unknown"}</p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-white font-medium">Evidence</h2>
        <div className="mt-2 grid gap-4 md:grid-cols-2 text-sm">
          <div>
            <p className="text-slate-400">Canary IDs (scrubbed)</p>
            <ul className="mt-1 list-disc pl-5 text-slate-200">
              {(data.evidence?.canary ?? []).map((c, i) => (<li key={i}>{c}</li>))}
            </ul>
          </div>
          <div>
            <p className="text-slate-400">Jailbreak Evidence</p>
            <ul className="mt-1 list-disc pl-5 text-slate-200">
              {(data.evidence?.jailbreak ?? []).map((j, i) => (<li key={i}>{j}</li>))}
            </ul>
          </div>
        </div>
        <div className="mt-3 text-sm text-slate-300">
          <p><span className="text-slate-400">SpendCap:</span> {(data.evidence?.spendCap ?? []).join(', ') || '—'} · <span className="text-slate-400">Total Spend:</span> ${data.evidence?.totalSpendUSD ?? 0}</p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
        <h2 className="text-white font-medium">Transcript Hits (Minimal Diff)</h2>
        {data.transcript_hits.length === 0 ? (
          <p className="text-slate-400 text-sm">No matching lines.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.transcript_hits.map((h) => (
              <li key={h.index} className="rounded-md border border-slate-800 bg-slate-900 p-3">
                <p className="text-xs text-slate-500">#{h.index} · {h.role}</p>
                <p className="text-slate-200 text-sm whitespace-pre-wrap">{h.content_masked}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

