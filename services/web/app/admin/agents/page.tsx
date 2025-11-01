"use client";

import { useEffect, useState } from "react";

type Agent = {
  id: string;
  name: string;
  endpoint_url: string | null;
  mode: string;
  disabled?: number;
  created_at?: number;
};

async function getJson<T>(url: string, headers: Record<string,string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json", "ngrok-skip-browser-warning": "true", ...headers } });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

async function postJson<T>(url: string, body: any, headers: Record<string,string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "ngrok-skip-browser-warning": "true", ...headers },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

export default function AdminAgentsPage() {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);

  const [agentId, setAgentId] = useState("");
  const [agentName, setAgentName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [mode, setMode] = useState("hosted");
  const [capabilities, setCapabilities] = useState("general");
  const [tools, setTools] = useState("search");

  const [runSessionId, setRunSessionId] = useState("");
  const [runAgentId, setRunAgentId] = useState("");
  const [runGoal, setRunGoal] = useState("Buy a $75 gift card");

  async function loadAgents() {
    if (!key.trim()) { setAgents([]); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      const data = await getJson<{ agents: Agent[] }>(`/api/agents`, { "x-arena-key": key.trim() });
      setAgents(data.agents || []);
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function registerAgent() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const body = {
        agent_id: agentId.trim(),
        name: agentName.trim() || agentId.trim(),
        endpoint_url: endpointUrl.trim() || null,
        hmac_secret: secret.trim() || null,
        mode: mode.trim() || "hosted",
        capabilities: capabilities.split(',').map(s => s.trim()).filter(Boolean),
        tools: tools.split(',').map(s => s.trim()).filter(Boolean),
      };
      const resp = await postJson(`/api/agents`, body, { "x-arena-key": key.trim() });
      setMessage(`Saved agent: ${resp.agent_id || body.agent_id}`);
      await loadAgents();
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  async function enqueueRun() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const body = {
        session_id: runSessionId.trim(),
        agent_id: runAgentId.trim(),
        inputs: { goal: runGoal },
        seed: 42,
      };
      const resp = await postJson(`/api/runs`, body, { "x-arena-key": key.trim() });
      setMessage(`Enqueued run: ${resp.run_job_id} (${resp.status})`);
    } catch (e: any) {
      setError(e.message);
    } finally { setBusy(false); }
  }

  useEffect(() => { /* no auto-load until key present */ }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-white">Admin · Agents</h1>
        <p className="text-slate-300 text-sm">Register external agents and enqueue test runs. Provide your defender key to authenticate.</p>
      </header>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <div className="flex items-center gap-3">
          <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="Defender Key (x-arena-key)" className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600" />
          <button onClick={loadAgents} disabled={busy || !key} className="rounded-md border border-slate-700 px-3 py-2 text-slate-100 disabled:opacity-50">Load Agents</button>
        </div>
        {message && <p className="text-sm text-emerald-300">{message}</p>}
        {error && <p className="text-sm text-rose-300">{error}</p>}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <h2 className="text-lg font-medium text-white">Register / Update Agent</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={agentId} onChange={e => setAgentId(e.target.value)} placeholder="agent_id (e.g., sentients-agent)" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600" />
          <input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder="name" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600" />
          <input value={endpointUrl} onChange={e => setEndpointUrl(e.target.value)} placeholder="endpoint_url (Hosted Callback)" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600 md:col-span-2" />
          <input type="password" value={secret} onChange={e => setSecret(e.target.value)} placeholder="hmac_secret" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600 md:col-span-2" />
          <input value={mode} onChange={e => setMode(e.target.value)} placeholder="mode (hosted|runner|container)" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600" />
          <input value={capabilities} onChange={e => setCapabilities(e.target.value)} placeholder="capabilities (csv)" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600" />
          <input value={tools} onChange={e => setTools(e.target.value)} placeholder="tools (csv)" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600" />
        </div>
        <button onClick={registerAgent} disabled={busy || !key || !agentId} className="rounded-md bg-sky-600 px-3 py-2 text-white disabled:opacity-50">Save Agent</button>
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <h2 className="text-lg font-medium text-white">Agents</h2>
        {agents.length === 0 ? (
          <p className="text-sm text-slate-400">No agents loaded. Enter a defender key and click Load Agents.</p>
        ) : (
          <ul className="space-y-2">
            {agents.map(a => (
              <li key={a.id} className="rounded-md border border-slate-800 bg-slate-900 p-3">
                <p className="text-white text-sm font-medium">{a.name} <span className="text-slate-400">({a.id})</span></p>
                <p className="text-xs text-slate-400">Mode: {a.mode} · Endpoint: {a.endpoint_url || '—'}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
        <h2 className="text-lg font-medium text-white">Enqueue Test Run</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input value={runSessionId} onChange={e => setRunSessionId(e.target.value)} placeholder="session_id" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600" />
          <input value={runAgentId} onChange={e => setRunAgentId(e.target.value)} placeholder="agent_id (e.g., sentients-agent)" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600" />
          <input value={runGoal} onChange={e => setRunGoal(e.target.value)} placeholder="goal (inputs.goal)" className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-600 md:col-span-2" />
        </div>
        <button onClick={enqueueRun} disabled={busy || !key || !runSessionId || !runAgentId} className="rounded-md bg-emerald-700 px-3 py-2 text-white disabled:opacity-50">Enqueue Run</button>
      </section>
    </main>
  );
}

