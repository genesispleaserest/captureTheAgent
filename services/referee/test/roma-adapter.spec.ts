import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTempDbPath } from "./helpers";

// Sample inputs matching @arena/core zod schemas
const samplePolicy = {
  agent_id: "test-agent",
  capabilities: ["general"],
  limits: { max_order_usd: 50, pii_output: "deny", jurisdictions_blocklist: [] },
  forbid: ["jailbreak"],
};

const sampleClaim = {
  session_id: "", // will be set at runtime to created session
  transcript: [
    { role: "user" as const, content: "Say hello" },
    { role: "agent" as const, content: "Hello" },
  ],
  artifacts: [],
  alleged: [],
};

describe("ROMA adapter", () => {
  const originalEnv = { ...process.env };
  let cleanup: () => void = () => {};

  beforeEach(async () => {
    // fresh temp DB per test
    const tmp = createTempDbPath();
    process.env.ARENA_DB_PATH = tmp.path;
    cleanup = tmp.cleanup;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    try { cleanup(); } catch {}
    vi.restoreAllMocks();
  });

  it("produces a reproduced verdict and regression URL when sandbox reports a hit", async () => {
    // Mock the sandbox result used by the adapter
    vi.mock("../src/worker-repro", () => ({
      autoRepro: vi.fn().mockResolvedValue({
        reproduced: true,
        severity: "MEDIUM",
        run: { logs: [], detectors: { canary: ["seed_email@example.com"] } },
      }),
    }));

    const { runROMASubgraph } = await import("../src/roma-adapter");
    const { getDatabase } = await import("../src/db");

    // Create session and run claim through subgraph
    const inputs = { policy: samplePolicy, claim: { ...sampleClaim } };
    const out = await runROMASubgraph("RefereeArena", inputs);

    expect(out.session.session_id).toBeTruthy();
    expect(out.verdict.reproduced).toBe(true);
    expect(out.verdict.severity).toBe("MEDIUM");
    expect(out.verdict.regression_url).toMatch(/^\//);

    // Verify DB rows persisted
    const db = getDatabase();
    const verdicts = db.prepare("SELECT reproduced, severity FROM verdicts").all();
    expect(verdicts.length).toBe(1);
    expect(verdicts[0].reproduced).toBe(1);
    expect(verdicts[0].severity).toBe("MEDIUM");
  });

  it("produces a non-reproduced verdict without regression URL when sandbox reports no hit", async () => {
    vi.mock("../src/worker-repro", () => ({
      autoRepro: vi.fn().mockResolvedValue({
        reproduced: false,
        severity: "NONE",
        run: { logs: [], detectors: { canary: [] } },
      }),
    }));

    const { runROMASubgraph } = await import("../src/roma-adapter");
    const { getDatabase } = await import("../src/db");

    const inputs = { policy: samplePolicy, claim: { ...sampleClaim } };
    const out = await runROMASubgraph("RefereeArena", inputs);

    expect(out.verdict.reproduced).toBe(false);
    expect(out.verdict.severity).toBe("NONE");
    expect(out.verdict.regression_url).toBeNull();

    const db = getDatabase();
    const verdicts = db.prepare("SELECT reproduced, severity FROM verdicts").all();
    expect(verdicts.length).toBe(1);
    expect(verdicts[0].reproduced).toBe(0);
    expect(verdicts[0].severity).toBe("NONE");
  });
});
