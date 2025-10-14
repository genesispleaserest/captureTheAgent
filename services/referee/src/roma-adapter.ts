import { randomUUID as uuid } from "crypto";
import { PolicyManifest, AttackClaim } from "@arena/core";
import { getDatabase } from "./db.js";
import { autoRepro } from "./worker-repro.js";
import { exportRegressionPackAsync } from "./regression.js";

const db = getDatabase();

type ParsedPolicy = ReturnType<typeof PolicyManifest.parse>;
type ParsedClaim = ReturnType<typeof AttackClaim.parse>;

interface ProcessClaimOptions {
  policyOverride?: ParsedPolicy;
  seedOverride?: number;
}

export async function createSession(policyInput: unknown, seed?: number) {
  const policy = PolicyManifest.parse(policyInput);
  const sessionId = uuid();
  const sessionSeed = seed ?? Date.now();

  const stmt = db.prepare(`
    INSERT INTO sessions (id, policy, seed)
    VALUES (?, ?, ?)
  `);
  stmt.run(sessionId, JSON.stringify(policy), sessionSeed);

  return {
    session_id: sessionId,
    policy,
    seed: sessionSeed,
    created_at: Math.floor(Date.now() / 1000)
  };
}

export async function processClaim(
  claimInput: unknown,
  options: ProcessClaimOptions = {}
) {
  const claim = AttackClaim.parse(claimInput);

  const sessionRow = db.prepare(`
    SELECT policy, seed FROM sessions
    WHERE id = ?
  `).get(claim.session_id) as { policy: string; seed: number } | undefined;

  const policy: ParsedPolicy | null =
    options.policyOverride ?? (sessionRow ? JSON.parse(sessionRow.policy) : null);

  if (!policy) {
    throw new Error(`No policy found for session ${claim.session_id}`);
  }

  const seed = options.seedOverride ?? sessionRow?.seed ?? Date.now();
  const claimId = uuid();

  insertClaim(claimId, claim, "processing");

  try {
    const result = await autoRepro(claim, policy);
    const runId = saveRun(claimId, result.run, seed);

    let regressionPath: string | undefined;
    if (result.reproduced) {
      try {
        regressionPath = await exportRegressionPackAsync(result.run);
      } catch (error) {
        console.error(`[ROMA] Failed to export regression pack for claim ${claimId}:`, error);
      }
    }

    const verdictId = saveVerdict(claimId, runId, result, regressionPath);
    updateClaimStatus(claimId, "completed");

    return formatVerdictResponse({
      claimId,
      runId,
      verdictId,
      result,
      regressionPath
    });
  } catch (error) {
    console.error(`[ROMA] Error while processing claim ${claimId}:`, error);
    updateClaimStatus(claimId, "failed");
    throw error;
  }
}

export async function runROMASubgraph(name: "RefereeArena", inputs: any) {
  if (name !== "RefereeArena") {
    throw new Error(`Unsupported subgraph: ${name}`);
  }

  const session = await createSession(inputs?.policy, inputs?.seed);
  const claimPayload = {
    ...inputs?.claim,
    session_id: inputs?.claim?.session_id ?? session.session_id
  };

  const verdict = await processClaim(claimPayload, {
    policyOverride: session.policy,
    seedOverride: session.seed
  });

  return { session, verdict };
}

function insertClaim(id: string, claim: ParsedClaim, status: string) {
  const stmt = db.prepare(`
    INSERT INTO claims (id, session_id, transcript, artifacts, alleged, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    claim.session_id,
    JSON.stringify(claim.transcript ?? []),
    JSON.stringify(claim.artifacts ?? []),
    JSON.stringify(claim.alleged ?? []),
    status
  );
}

function updateClaimStatus(claimId: string, status: string) {
  const stmt = db.prepare(`
    UPDATE claims
    SET status = ?, processed_at = (strftime('%s', 'now'))
    WHERE id = ?
  `);
  stmt.run(status, claimId);
}

function saveRun(claimId: string, run: any, seed: number): string {
  const runId = uuid();
  const stmt = db.prepare(`
    INSERT INTO runs (id, claim_id, seed, logs, detectors)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(
    runId,
    claimId,
    seed,
    JSON.stringify(run.logs ?? []),
    JSON.stringify(run.detectors ?? {})
  );

  return runId;
}

function saveVerdict(
  claimId: string,
  runId: string,
  result: { reproduced: boolean; severity: string; run: any },
  regressionPath?: string
): string {
  const verdictId = uuid();
  const stmt = db.prepare(`
    INSERT INTO verdicts (id, claim_id, reproduced, severity, run_id, regression_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    verdictId,
    claimId,
    result.reproduced ? 1 : 0,
    result.severity,
    runId,
    regressionPath ?? null
  );

  return verdictId;
}

function formatVerdictResponse({
  claimId,
  runId,
  verdictId,
  result,
  regressionPath
}: {
  claimId: string;
  runId: string;
  verdictId: string;
  result: { reproduced: boolean; severity: string; run: any };
  regressionPath?: string;
}) {
  let cleanedPath = regressionPath ?? null;
  if (cleanedPath) {
    if (cleanedPath.startsWith("./")) {
      cleanedPath = cleanedPath.slice(2);
    }
    while (cleanedPath.startsWith("/") || cleanedPath.startsWith("\\")) {
      cleanedPath = cleanedPath.slice(1);
    }
  }
  const regressionUrl = cleanedPath ? `/${cleanedPath}` : null;

  return {
    claim_id: claimId,
    run_id: runId,
    verdict_id: verdictId,
    reproduced: result.reproduced,
    severity: result.severity,
    regression_path: regressionPath ?? null,
    regression_url: regressionUrl
  };
}
