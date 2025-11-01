import express from "express";
import { randomUUID as uuid, createHash, createHmac } from "crypto";
import { PolicyManifest, AttackClaim } from "@arena/core";
import cors from "cors";
import { getDatabase } from "./db.js";
import swaggerUi from "swagger-ui-express";
import sharp from "sharp";
import * as cookie from "cookie";

const app = express();

// Optional trust proxy (set when behind a reverse proxy)
if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

// Configure CORS: in production, require explicit allowlist via ARENA_ALLOWED_ORIGINS
const allowedOriginsEnv = process.env.ARENA_ALLOWED_ORIGINS;
const isProd = process.env.NODE_ENV === "production";
let corsOptions: cors.CorsOptions | undefined;

if (allowedOriginsEnv) {
  const origins = allowedOriginsEnv
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  corsOptions = { origin: origins };
} else if (isProd) {
  console.warn(
    "ARENA_ALLOWED_ORIGINS is not set; refusing all cross-origin requests in production."
  );
  corsOptions = { origin: [] };
}

app.use(cors(corsOptions));

// Limit JSON payload size (default 1mb; configurable via ARENA_JSON_LIMIT)
const jsonLimit = process.env.ARENA_JSON_LIMIT ?? "1mb";
app.use(express.json({ limit: jsonLimit }));
// Helper: read user from HMAC cookie
function getUserFromRequest(req: express.Request): { id: string; email?: string } | null {
  try {
    const hdr = req.headers['cookie'];
    if (!hdr) return null;
    const parsed = cookie.parse(Array.isArray(hdr) ? hdr.join(';') : hdr);
    const tok = parsed['arena_session'];
    if (!tok) return null;
    const secret = process.env.ARENA_SESSION_SECRET || 'dev-secret';
    const [b64, sig] = tok.split('.');
    if (!b64 || !sig) return null;
    const check = createHmac('sha256', secret).update(b64).digest('hex');
    if (check !== sig) return null;
    const json = Buffer.from(b64, 'base64url').toString('utf8');
    const payload = JSON.parse(json);
    if (!payload?.id) return null;
    return { id: payload.id, email: payload.email };
  } catch { return null; }
}
function setSessionCookie(res: express.Response, user: { id: string; email?: string }) {
  const secret = process.env.ARENA_SESSION_SECRET || 'dev-secret';
  const b64 = Buffer.from(JSON.stringify({ id: user.id, email: user.email || null }), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(b64).digest('hex');
  const value = `${b64}.${sig}`;
  const cookieStr = cookie.serialize('arena_session', value, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    path: '/'
  });
  res.setHeader('Set-Cookie', cookieStr);
}

function clearSessionCookie(res: express.Response) {
  const cookieStr = cookie.serialize('arena_session', '', {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 0,
    path: '/'
  });
  res.setHeader('Set-Cookie', cookieStr);
}
// Request ID + structured access logging
app.use((req, res, next) => {
  const headerId = req.header("x-request-id");
  const reqId = headerId && headerId.trim().length > 0 ? headerId : uuid();
  (req as any).id = reqId;
  res.setHeader("x-request-id", reqId);
  const start = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const entry = {
      level: "info",
      msg: "request",
      reqId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs
    };
    console.log(JSON.stringify(entry));
  });
  next();
});
app.use("/artifacts", express.static("artifacts"));

// Initialize SQLite database
const db = getDatabase();

// in-memory sessions for now (will migrate to db later)
const sessions = new Map<string, any>();

// Simple in-memory rate limiter (per IP)
const windowMs = Number(process.env.ARENA_RATE_LIMIT_WINDOW_MS ?? 60_000); // default 1 minute
const maxRequests = Number(process.env.ARENA_RATE_LIMIT_MAX ?? 120); // default 120 req/min
type Counter = { count: number; resetAt: number };
const counters = new Map<string, Counter>();

function rateLimit(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const key = `${req.ip}`;
  const now = Date.now();
  const entry = counters.get(key);
  if (!entry || now > entry.resetAt) {
    counters.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  if (entry.count >= maxRequests) {
    const retryAfter = Math.max(0, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "rate_limited", retry_after: retryAfter });
  }
  entry.count++;
  return next();
}

// Apply basic rate limiting globally
app.use(rateLimit);

// Liveness/Readiness/Health endpoints
app.get("/live", (_req, res) => res.json({ status: "ok" }));
app.get("/ready", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    return res.json({ status: "ok" });
  } catch {
    return res.status(503).json({ status: "degraded" });
  }
});
// Back-compat
app.get("/health", (req, res) => {
  res.redirect(307, "/ready");
});

// Route-specific stricter rate limits
function makeLimiter(scope: string, winMs: number, max: number) {
  const map = new Map<string, Counter>();
  return function scopedLimiter(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const key = `${scope}:${req.ip}`;
    const now = Date.now();
    const entry = map.get(key);
    if (!entry || now > entry.resetAt) {
      map.set(key, { count: 1, resetAt: now + winMs });
      return next();
    }
    if (entry.count >= max) {
      const retryAfter = Math.max(0, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "rate_limited", retry_after: retryAfter });
    }
    entry.count++;
    return next();
  };
}

const claimsWin = Number(process.env.ARENA_RATE_LIMIT_CLAIMS_WINDOW_MS ?? 60_000);
const claimsMax = Number(process.env.ARENA_RATE_LIMIT_CLAIMS_MAX ?? 30);
const sessionsWin = Number(process.env.ARENA_RATE_LIMIT_SESSIONS_WINDOW_MS ?? 60_000);
const sessionsMax = Number(process.env.ARENA_RATE_LIMIT_SESSIONS_MAX ?? 20);
const claimsLimiter = makeLimiter("claims", claimsWin, claimsMax);
const sessionsLimiter = makeLimiter("sessions", sessionsWin, sessionsMax);

// Per-session claim caps (per attacker/session)
const claimSessionWin = Number(process.env.ARENA_RATE_LIMIT_CLAIMS_SESSION_WINDOW_MS ?? 60_000);
const claimSessionMax = Number(process.env.ARENA_RATE_LIMIT_CLAIMS_SESSION_MAX ?? 10);
function claimsPerSessionLimiter(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const sessionId = String((req.body?.session_id ?? "")).trim();
    if (!sessionId) return res.status(400).json({ error: "invalid_session" });
    (claimsPerSessionLimiter as any)._map = (claimsPerSessionLimiter as any)._map || new Map<string, Counter>();
    const map: Map<string, Counter> = (claimsPerSessionLimiter as any)._map;
    const key = `${sessionId}`;
    const now = Date.now();
    const entry = map.get(key);
    if (!entry || now > entry.resetAt) {
      map.set(key, { count: 1, resetAt: now + claimSessionWin });
      return next();
    }
    if (entry.count >= claimSessionMax) {
      const retryAfter = Math.max(0, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({ error: "rate_limited", retry_after: retryAfter });
    }
    entry.count++;
    return next();
  } catch {
    return res.status(400).json({ error: "invalid_request" });
  }
}

// Defender auth for builder-only endpoints
function requireDefenderKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const required = process.env.ARENA_DEFENDER_KEY;
  if (!required) return next();
  const key = req.header('x-arena-key');
  if (key && key === required) return next();
  return res.status(401).json({ error: 'unauthorized' });
}

// Swagger UI at /docs backed by our OpenAPI JSON
try {
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(undefined, {
    swaggerOptions: { url: "/openapi.json" }
  }));
} catch (e) {
  console.warn("Swagger UI not initialized", e);
}

// Redoc at /redoc (client loads script from CDN)
app.get("/redoc", (_req, res) => {
  const html = `<!doctype html>
  <html>
    <head>
      <meta charset='utf-8'/>
      <title>Arena Referee API – Redoc</title>
      <meta name="viewport" content="width=device-width, initial-scale=1"/>
      <style>body{margin:0;padding:0} .wrap{height:100vh}</style>
    </head>
    <body>
      <redoc spec-url='/openapi.json' class='wrap'></redoc>
      <script src='https://cdn.jsdelivr.net/npm/redoc@next/bundles/redoc.standalone.js'></script>
    </body>
  </html>`;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(html);
});

/**
 * @openapi
 * /sessions:
 *   post:
 *     summary: Create a new challenge session
 *     description: Creates a new challenge session with the specified policy manifest
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - policy
 *             properties:
 *               policy:
 *                 $ref: '#/components/schemas/PolicyManifest'
 *               seed:
 *                 type: number
 *                 description: Random seed for reproducible challenges
 *                 example: 1234567890
 *     responses:
 *       200:
 *         description: Session created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 session_id:
 *                   type: string
 *                   format: uuid
 *                   example: "123e4567-e89b-12d3-a456-426614174000"
 *       400:
 *         description: Invalid policy manifest
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: object
 *                   description: Zod validation error details
 */
app.post("/sessions", requireDefenderKey, sessionsLimiter, (req, res) => {
  const parse = PolicyManifest.safeParse(req.body.policy);
  if (!parse.success) return res.status(400).json(parse.error);
  const id = uuid();
  const seed = req.body.seed ?? Date.now();
  const user = getUserFromRequest(req);
  sessions.set(id, { id, policy: parse.data, seed, created: Date.now(), user_id: user?.id || null });

  const stmt = db.prepare(`
    INSERT INTO sessions (id, policy, seed, user_id)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(id, JSON.stringify(parse.data), seed, user?.id || null);
  res.json({ session_id: id });
});

/**
 * @openapi
 * /claims:
 *   post:
 *     summary: Submit an attack claim
 *     description: Submit a claim of successful attack against a challenge session
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AttackClaim'
 *     responses:
 *       200:
 *         description: Claim queued for processing
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [queued]
 *                   example: "queued"
 *       400:
 *         description: Invalid attack claim format
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: object
 *                   description: Zod validation error details
 */
app.post("/claims", claimsLimiter, claimsPerSessionLimiter, async (req, res) => {
  const parse = AttackClaim.safeParse(req.body);
  if (!parse.success) return res.status(400).json(parse.error);
  
  // Save claim to database
  const idempotencyKey = (req.header('Idempotency-Key') || '').trim();
  if (idempotencyKey) {
    const existing = db.prepare(`SELECT id FROM claims WHERE idempotency_key = ?`).get(idempotencyKey) as any;
    if (existing?.id) {
      return res.json({ status: "queued", claim_id: existing.id });
    }
  }
  const claimId = uuid();
  const stmt = db.prepare(`
    INSERT INTO claims (id, session_id, transcript, artifacts, alleged, idempotency_key, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `);
  stmt.run(
    claimId,
    parse.data.session_id,
    JSON.stringify(parse.data.transcript),
    JSON.stringify(parse.data.artifacts),
    JSON.stringify(parse.data.alleged),
    idempotencyKey || null
  );
  
  res.json({ status: "queued", claim_id: claimId });
});

/**
 * @openapi
 * /leaderboard:
 *   get:
 *     summary: Get current leaderboard
 *     description: Returns the current leaderboard with attacker/defender rankings and statistics
 *     responses:
 *       200:
 *         description: Leaderboard data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 attackers:
 *                   type: array
 *                   items:
 *                     type: object
 *                   description: List of top attackers
 *                 defenders:
 *                   type: array
 *                   items:
 *                     type: object
 *                   description: List of top defenders
 *                 stats:
 *                   type: object
 *                   properties:
 *                     confirmed:
 *                       type: number
 *                       description: Number of confirmed attacks
 *                       example: 0
 *                     pending:
 *                       type: number
 *                       description: Number of pending claims
 *                       example: 5
 */
app.get("/leaderboard", (req, res) => {
  const totalStmt = db.prepare("SELECT COUNT(*) as count FROM claims");
  const pendingStmt = db.prepare("SELECT COUNT(*) as count FROM claims WHERE status = 'pending'");
  const confirmedStmt = db.prepare("SELECT COUNT(*) as count FROM verdicts WHERE reproduced = 1");
  const recentStmt = db.prepare(`
    SELECT 
      v.id,
      v.claim_id,
      v.severity,
      v.created_at,
      v.regression_path,
      c.session_id,
      s.user_id
    FROM verdicts v
    JOIN claims c ON v.claim_id = c.id
    LEFT JOIN sessions s ON c.session_id = s.id
    WHERE v.reproduced = 1
    ORDER BY v.created_at DESC
    LIMIT 10
  `);

  const total = (totalStmt.get() as { count?: number } | undefined)?.count ?? 0;
  const pending = (pendingStmt.get() as { count?: number } | undefined)?.count ?? 0;
  const confirmed = (confirmedStmt.get() as { count?: number } | undefined)?.count ?? 0;
  const recentRows = recentStmt.all() as Array<{
    id: string;
    claim_id: string;
    severity: string;
    created_at: number;
    regression_path: string | null;
    session_id: string;
    user_id: string | null;
  }>;

  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const recent_kills = recentRows.map((row) => {
    const cleanedPath = row.regression_path?.replace(/^\.\//, "") ?? null;
    const normalizedPath = cleanedPath?.replace(/^\\/, "");
    const regression_url = normalizedPath ? `${baseUrl}/${normalizedPath.replace(/^\//, "")}` : null;

    const user_avatar = row.user_id ? `${baseUrl}/users/${row.user_id}/avatar.png` : null;
    return {
      verdict_id: row.id,
      claim_id: row.claim_id,
      session_id: row.session_id,
      severity: row.severity,
      created_at: row.created_at,
      regression_path: row.regression_path,
      regression_url,
      user_id: row.user_id,
      user_avatar
    };
  });

  res.json({
    attackers: [],
    defenders: [],
    stats: {
      total,
      confirmed,
      pending
    },
    recent_kills
  });
});

/**
 * @openapi
 * /openapi.json:
 *   get:
 *     summary: Get OpenAPI specification
 *     description: Returns the OpenAPI 3.0 specification for this API
 *     responses:
 *       200:
 *         description: OpenAPI specification
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
app.get("/openapi.json", (req, res) => {
  const openApiSpec = {
    openapi: "3.0.0",
    info: {
      title: "Arena Referee API",
      description: "API for managing red-team arena challenges and attack claims",
      version: "1.0.0"
    },
    servers: [
      {
        url: "http://localhost:8080",
        description: "Development server"
      }
    ],
    paths: {
      "/sessions": {
        post: {
          summary: "Create a new challenge session",
          description: "Creates a new challenge session with the specified policy manifest",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["policy"],
                  properties: {
                    policy: { $ref: "#/components/schemas/PolicyManifest" },
                    seed: {
                      type: "number",
                      description: "Random seed for reproducible challenges",
                      example: 1234567890
                    }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Session created successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      session_id: {
                        type: "string",
                        format: "uuid",
                        example: "123e4567-e89b-12d3-a456-426614174000"
                      }
                    }
                  }
                }
              }
            },
            "400": {
              description: "Invalid policy manifest",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      error: {
                        type: "object",
                        description: "Zod validation error details"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/claims": {
        post: {
          summary: "Submit an attack claim",
          description: "Submit a claim of successful attack against a challenge session",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AttackClaim" }
              }
            }
          },
          responses: {
            "200": {
              description: "Claim queued for processing",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      status: {
                        type: "string",
                        enum: ["queued"],
                        example: "queued"
                      }
                    }
                  }
                }
              }
            },
            "400": {
              description: "Invalid attack claim format",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      error: {
                        type: "object",
                        description: "Zod validation error details"
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/leaderboard": {
        get: {
          summary: "Get current leaderboard",
          description: "Returns the current leaderboard with attacker/defender rankings and statistics",
          responses: {
            "200": {
              description: "Leaderboard data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      attackers: {
                        type: "array",
                        items: { type: "object" },
                        description: "List of top attackers"
                      },
                      defenders: {
                        type: "array",
                        items: { type: "object" },
                        description: "List of top defenders"
                      },
                      stats: {
                        type: "object",
                        properties: {
                          confirmed: {
                            type: "number",
                            description: "Number of confirmed attacks",
                            example: 0
                          },
                          pending: {
                            type: "number",
                            description: "Number of pending claims",
                            example: 5
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        PolicyManifest: {
          type: "object",
          required: ["agent_id", "capabilities"],
          properties: {
            agent_id: {
              type: "string",
              description: "Unique identifier for the agent"
            },
            capabilities: {
              type: "array",
              items: { type: "string" },
              description: "List of agent capabilities"
            },
            limits: {
              type: "object",
              properties: {
                max_order_usd: {
                  type: "number",
                  default: 50,
                  description: "Maximum order value in USD"
                },
                pii_output: {
                  type: "string",
                  enum: ["deny", "mask"],
                  default: "deny",
                  description: "PII output handling policy"
                },
                jurisdictions_blocklist: {
                  type: "array",
                  items: { type: "string" },
                  default: [],
                  description: "Blocked jurisdictions"
                }
              }
            },
            forbid: {
              type: "array",
              items: { type: "string" },
              default: [],
              description: "Forbidden actions"
            }
          }
        },
        AttackClaim: {
          type: "object",
          required: ["session_id", "transcript", "alleged"],
          properties: {
            session_id: {
              type: "string",
              description: "ID of the attacked session"
            },
            transcript: {
              type: "array",
              items: {
                type: "object",
                required: ["role", "content"],
                properties: {
                  role: {
                    type: "string",
                    enum: ["user", "agent"]
                  },
                  content: {
                    type: "string"
                  }
                }
              },
              description: "Conversation transcript"
            },
            artifacts: {
              type: "array",
              items: { type: "string" },
              default: [],
              description: "Attack artifacts (file hashes, etc.)"
            },
            alleged: {
              type: "array",
              items: {
                type: "string",
                enum: ["PII_EXFIL", "JAILBREAK", "SPEND_CAP", "PRIV_ESC", "PROMPT_INJECTION"]
              },
              description: "Types of violations alleged"
            }
          }
        }
      }
    }
  };
  
  res.json(openApiSpec);
});

/**
 * @openapi
 * /claims/{id}/verdict:
 *   get:
 *     summary: Get verdict for a specific claim
 *     description: Returns the verdict and regression pack path for a completed claim
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Claim ID
 *     responses:
 *       200:
 *         description: Verdict information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 verdict_id:
 *                   type: string
 *                 claim_id:
 *                   type: string
 *                 reproduced:
 *                   type: boolean
 *                 severity:
 *                   type: string
 *                 regression_path:
 *                   type: string
 *                   nullable: true
 *                 created_at:
 *                   type: integer
 *       404:
 *         description: Claim not found or no verdict available
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
app.get("/claims/:id/verdict", (req, res) => {
  const claimId = req.params.id;
  
  const stmt = db.prepare(`
    SELECT 
      v.*,
      c.status as claim_status,
      c.transcript as claim_transcript
    FROM verdicts v
    JOIN claims c ON v.claim_id = c.id
    WHERE v.claim_id = ?
  `);
  
  const verdict = stmt.get(claimId) as any;
  
  if (!verdict) {
    return res.status(404).json({ error: "Verdict not found" });
  }
  // Compute minimal transcript hits from evidence
  let transcript_hits: Array<{ index:number; role:string; content_masked:string }> = [];
  try {
    const transcript = JSON.parse(verdict.claim_transcript || '[]');
    const evidence = verdict.evidence ? JSON.parse(verdict.evidence) : {};
    const canaries: string[] = Array.isArray(evidence?.canary) ? evidence.canary : [];
    const mask = (text: string) => canaries.reduce((t, c) => t.replaceAll(c, c.replace(/.(?=.{2})/g, '*')), text);
    transcript.forEach((m: any, idx: number) => {
      const raw = String(m?.content ?? '');
      if (canaries.some(c => raw.includes(c))) {
        transcript_hits.push({ index: idx, role: m.role, content_masked: mask(raw) });
      }
    });
  } catch {}

  res.json({
    verdict_id: verdict.id,
    claim_id: verdict.claim_id,
    reproduced: Boolean(verdict.reproduced),
    severity: verdict.severity,
    regression_path: verdict.regression_path,
    created_at: verdict.created_at,
    claim_status: verdict.claim_status,
    detectors_version: verdict.detectors_version || null,
    env_hash: verdict.env_hash || null,
    evidence: verdict.evidence ? JSON.parse(verdict.evidence) : null,
    transcript_hits
  });
});

// Register a webhook (url, secret, events[])
app.post("/webhooks", (req, res) => {
  const url = String(req.body?.url || "").trim();
  const secret = String(req.body?.secret || "").trim();
  const events = Array.isArray(req.body?.events) && req.body.events.length
    ? req.body.events.map((v: any) => String(v))
    : ["confirmed_claim", "patched"];

  if (!url || !secret) return res.status(400).json({ error: "url and secret are required" });
  const id = uuid();
  const stmt = db.prepare(`INSERT INTO webhooks (id, url, secret, events) VALUES (?, ?, ?, ?)`);
  stmt.run(id, url, secret, JSON.stringify(events));
  res.status(201).json({ id, url, events });
});

// Auth: signup, magic link, session, avatars
app.post("/signup", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'invalid_email' });
  // Simple per-email limiter (window 1m, max 5)
  (app as any)._signupMap = (app as any)._signupMap || new Map<string, {count:number; resetAt:number}>();
  const smap: Map<string, {count:number; resetAt:number}> = (app as any)._signupMap;
  const now = Date.now();
  const win = Number(process.env.ARENA_RATE_LIMIT_SIGNUP_WINDOW_MS ?? 60_000);
  const max = Number(process.env.ARENA_RATE_LIMIT_SIGNUP_MAX ?? 5);
  const e = smap.get(email);
  if (!e || now > e.resetAt) smap.set(email, { count: 1, resetAt: now + win });
  else if (e.count >= max) return res.status(429).json({ error: 'rate_limited' });
  else e.count++;

  let user = db.prepare(`SELECT id,email FROM users WHERE email = ?`).get(email) as any;
  if (!user) {
    const id = uuid();
    db.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run(id, email);
    user = { id, email };
  }
  const token = Buffer.from(`${uuid()}-${Date.now()}`).toString('base64url');
  const expires = Math.floor(Date.now()/1000) + 24*3600;
  db.prepare(`INSERT INTO magic_links (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, user.id, expires);
  // Prefer a configured public app URL (web domain), then an origin header from the caller, then fall back to this host
  const preferredBase = process.env.PUBLIC_APP_URL || String(req.header('x-app-origin') || '').trim();
  const base = preferredBase || `${req.protocol}://${req.get('host')}`;
  const nextPath = (typeof req.body?.next === 'string' && req.body.next.startsWith('/')) ? String(req.body.next) : '/';
  const link = `${base}/magic/${token}${nextPath !== '/' ? `?next=${encodeURIComponent(nextPath)}` : ''}`;
  // Send email if SMTP configured, else log
  if (process.env.SMTP_HOST) {
    (async () => {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || 'arena@example.com',
        to: email,
        subject: 'Your Arena magic link',
        text: `Sign in: ${link}`
      }).catch(err => console.error('[EMAIL] send failed', err));
    })();
  } else {
    console.log(`[ONBOARD] Magic link for ${email}: ${link}`);
  }
  // Always include magic_link in response to simplify dev/testing
  return res.json({ message: 'Magic link sent. Check your email.', user_id: user.id, magic_link: link });
});

app.get("/magic/:token", (req, res) => {
  const token = String(req.params.token || "").trim();
  const row = db.prepare(`SELECT m.*, u.email, u.id as user_id FROM magic_links m JOIN users u ON m.user_id = u.id WHERE m.token = ?`).get(token) as any;
  if (!row) return res.status(404).send('Invalid token');
  const now = Math.floor(Date.now()/1000);
  if (row.used_at) return res.status(410).send('Link already used');
  if (now > row.expires_at) return res.status(410).send('Link expired');
  db.prepare(`UPDATE magic_links SET used_at = ? WHERE token = ?`).run(now, token);
  setSessionCookie(res, { id: row.user_id, email: row.email });
  const nextParam = typeof req.query.next === 'string' ? String(req.query.next) : '/';
  const dest = nextParam.startsWith('/') ? nextParam : '/';
  res.redirect(302, dest);
});

app.get('/me', (req, res) => {
  const user = getUserFromRequest(req);
  if (!user) return res.status(200).json({ user: null });
  const avatar = `${req.protocol}://${req.get('host')}/users/${user.id}/avatar.png`;
  res.json({ user: { id: user.id, email: user.email || null, avatar } });
});

app.post('/signout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/signout', (_req, res) => {
  clearSessionCookie(res);
  res.redirect(302, '/');
});

// --- Onboarding: signup + magic link + avatars ---
app.post("/signup", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'invalid_email' });

  let user = db.prepare(`SELECT id,email FROM users WHERE email = ?`).get(email) as any;
  if (!user) {
    const id = uuid();
    db.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run(id, email);
    user = { id, email };
  }

  // Create magic link token (valid 24h)
  const token = (await import('crypto')).randomBytes(24).toString('hex');
  const expires = Math.floor(Date.now()/1000) + 24*3600;
  db.prepare(`INSERT INTO magic_links (token, user_id, expires_at) VALUES (?, ?, ?)`).run(token, user.id, expires);

  const base = `${req.protocol}://${req.get('host')}`;
  const nextPath = (typeof req.body?.next === 'string' && req.body.next.startsWith('/')) ? String(req.body.next) : '/';
  const link = `${base}/magic/${token}${nextPath !== '/' ? `?next=${encodeURIComponent(nextPath)}` : ''}`;

  console.log(`[ONBOARD] Magic link for ${email}: ${link}`);
  return res.json({ message: 'Magic link sent. Check your email.', user_id: user.id });
});

app.get("/magic/:token", (req, res) => {
  const token = String(req.params.token || "").trim();
  const row = db.prepare(`SELECT m.*, u.email FROM magic_links m JOIN users u ON m.user_id = u.id WHERE m.token = ?`).get(token) as any;
  if (!row) return res.status(404).send('Invalid token');
  const now = Math.floor(Date.now()/1000);
  if (row.used_at) return res.status(410).send('Link already used');
  if (now > row.expires_at) return res.status(410).send('Link expired');
  db.prepare(`UPDATE magic_links SET used_at = ? WHERE token = ?`).run(now, token);
  const nextParam = typeof req.query.next === 'string' ? String(req.query.next) : '/';
  const dest = nextParam.startsWith('/') ? nextParam : '/';
  res.redirect(302, dest);
});

function avatarSvg(seed: string, size = 64) {
  const h = createHash('sha256').update(seed).digest('hex');
  const color = `#${h.slice(0,6)}`;
  const bg = `#${h.slice(6,12)}`;
  const cells = 5;
  const cell = Math.floor(size / cells);
  let rects: string[] = [];
  for (let y=0; y<cells; y++) {
    for (let x=0; x<Math.ceil(cells/2); x++) {
      const bit = parseInt(h[(y*cells + x) % h.length], 16);
      if (bit % 2 === 0) {
        rects.push(`<rect x="${x*cell}" y="${y*cell}" width="${cell}" height="${cell}" fill="${color}"/>`);
        const mx = (cells - 1 - x);
        rects.push(`<rect x="${mx*cell}" y="${y*cell}" width="${cell}" height="${cell}" fill="${color}"/>`);
      }
    }
  }
  return `<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${size}\" height=\"${size}\" viewBox=\"0 0 ${size} ${size}\">
  <rect width=\"100%\" height=\"100%\" fill=\"${bg}\"/>
  ${rects.join('\\n  ')}
</svg>`;
}

app.get("/users/:id/avatar.svg", (req, res) => {
  const id = String(req.params.id || '').trim();
  const row = db.prepare(`SELECT email FROM users WHERE id = ?`).get(id) as any;
  const seed = row?.email || id;
  const svg = avatarSvg(seed);
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svg);
});

app.get("/users/:id/avatar.png", async (req, res) => {
  const id = String(req.params.id || '').trim();
  const row = db.prepare(`SELECT email FROM users WHERE id = ?`).get(id) as any;
  const seed = row?.email || id;
  const svg = avatarSvg(seed, 128);
  try {
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (e) {
    res.status(500).json({ error: 'avatar_render_failed' });
  }
});

// ========== External Agent Onboarding (Hosted Callback MVP) ==========
// agents: register/list; agent versions; run jobs (enqueue), partner callback -> claim queued

// Register an agent (defender only)
app.post("/agents", requireDefenderKey, (req, res) => {
  const body = req.body || {};
  const id = String(body.agent_id || '').trim();
  const name = String(body.name || id || '').trim();
  if (!id || !name) return res.status(400).json({ error: 'invalid_agent' });
  const endpoint_url = body.endpoint_url ? String(body.endpoint_url) : null;
  const hmac_secret = body.hmac_secret ? String(body.hmac_secret) : null;
  const mode = String(body.mode || 'hosted');
  const capabilities = JSON.stringify(Array.isArray(body.capabilities) ? body.capabilities : []);
  const tools = JSON.stringify(Array.isArray(body.tools) ? body.tools : []);
  try {
    const exists = db.prepare(`SELECT id FROM agents WHERE id = ?`).get(id) as any;
    if (exists) {
      db.prepare(`UPDATE agents SET name=?, endpoint_url=?, hmac_secret=?, mode=?, capabilities=?, tools=? WHERE id=?`)
        .run(name, endpoint_url, hmac_secret, mode, capabilities, tools, id);
    } else {
      db.prepare(`INSERT INTO agents (id, name, endpoint_url, hmac_secret, mode, capabilities, tools) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(id, name, endpoint_url, hmac_secret, mode, capabilities, tools);
    }
    res.status(201).json({ agent_id: id, name, endpoint_url, mode });
  } catch (e) {
    res.status(500).json({ error: 'agent_upsert_failed' });
  }
});

// List agents (defender/admin)
app.get("/agents", requireDefenderKey, (_req, res) => {
  const rows = db.prepare(`SELECT id, name, endpoint_url, mode, disabled, created_at FROM agents ORDER BY created_at DESC`).all();
  res.json({ agents: rows });
});

// Add agent version
app.post("/agents/:id/versions", requireDefenderKey, (req, res) => {
  const agentId = req.params.id;
  const version = String(req.body?.version || '').trim();
  if (!version) return res.status(400).json({ error: 'invalid_version' });
  const id = uuid();
  db.prepare(`INSERT INTO agent_versions (id, agent_id, version, model_id, notes) VALUES (?, ?, ?, ?, ?)`)
    .run(id, agentId, version, String(req.body?.model_id || ''), String(req.body?.notes || ''));
  res.status(201).json({ version_id: id, agent_id: agentId, version });
});

// Enqueue a run job (defender/admin)
app.post("/runs", requireDefenderKey, (req, res) => {
  const session_id = String(req.body?.session_id || '').trim();
  const agent_id = String(req.body?.agent_id || '').trim();
  if (!session_id || !agent_id) return res.status(400).json({ error: 'invalid_request' });
  const seed = req.body?.seed ?? Date.now();
  const inputs = JSON.stringify(req.body?.inputs || {});
  const id = uuid();
  db.prepare(`INSERT INTO run_jobs (id, session_id, agent_id, seed, inputs, status) VALUES (?, ?, ?, ?, ?, 'queued')`)
    .run(id, session_id, agent_id, seed, inputs);
  res.status(202).json({ run_job_id: id, status: 'queued' });
});

// Get job status
app.get("/runs/:id", requireDefenderKey, (req, res) => {
  const id = req.params.id;
  const row = db.prepare(`SELECT * FROM run_jobs WHERE id = ?`).get(id) as any;
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ job: row });
});

// Partner callback to complete a run job and queue a claim for the worker
app.post("/runs/:id/complete", (req, res) => {
  const id = req.params.id;
  const job = db.prepare(`SELECT * FROM run_jobs WHERE id = ?`).get(id) as any;
  if (!job) return res.status(404).json({ error: 'job_not_found' });
  const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(job.agent_id) as any;
  const secret = String(agent?.hmac_secret || '');
  if (!secret) return res.status(401).json({ error: 'agent_secret_missing' });

  try {
    const sig = String(req.headers['x-arena-signature'] || '').replace(/^sha256=/,'');
    const bodyStr = JSON.stringify(req.body || {});
    const check = createHmac('sha256', secret).update(bodyStr).digest('hex');
    if (sig.length === 0 || check !== sig) return res.status(401).json({ error: 'bad_sig' });
  } catch { return res.status(401).json({ error: 'sig_error' }); }

  // Expect { transcript: [...], metadata?, tool_calls? }
  const transcript = Array.isArray(req.body?.transcript) ? req.body.transcript : [];
  if (transcript.length === 0) return res.status(400).json({ error: 'empty_transcript' });

  // Create a pending claim so the existing worker processes it and issues a verdict
  const claimId = uuid();
  db.prepare(`INSERT INTO claims (id, session_id, transcript, artifacts, alleged, status) VALUES (?, ?, ?, '[]', '[]', 'pending')`)
    .run(claimId, job.session_id, JSON.stringify(transcript));

  // Mark job completed
  db.prepare(`UPDATE run_jobs SET status='completed', completed_at = (strftime('%s','now')) WHERE id = ?`).run(id);

  res.json({ ok: true, claim_id: claimId });
});

// Badge metrics helpers
function computeMetrics() {
  const total = (db.prepare("SELECT COUNT(*) as c FROM claims").get() as any)?.c ?? 0;
  const confirmed = (db.prepare("SELECT COUNT(*) as c FROM verdicts WHERE reproduced = 1").get() as any)?.c ?? 0;
  const times = db.prepare("SELECT created_at, processed_at FROM claims WHERE processed_at IS NOT NULL").all() as Array<{created_at:number, processed_at:number}>;
  const avgSecs = times.length ? Math.round(times.reduce((s, r) => s + (r.processed_at - r.created_at), 0) / times.length) : null;
  const reproRate = total ? Math.round((confirmed / total) * 100) : 0;
  const defenderScore = 100 - reproRate;
  const fastPatch = avgSecs === null ? null : Math.max(0, Math.round(avgSecs / 60));
  return { total, confirmed, reproRate, defenderScore, fastPatch };
}

function colorForPercent(p: number) {
  if (p >= 70) return "red";
  if (p >= 30) return "orange";
  return "green";
}

// Badges JSON
app.get("/badges/:name.json", (req, res) => {
  const { name } = req.params;
  const m = computeMetrics();
  let label = name;
  let message = "n/a";
  let color = "gray";

  if (name === "reproRate") {
    label = "repro rate";
    message = `${m.reproRate}%`;
    color = colorForPercent(m.reproRate);
  } else if (name === "defenderScore") {
    label = "defender score";
    message = `${m.defenderScore}`;
    color = colorForPercent(100 - m.defenderScore);
  } else if (name === "fastPatch") {
    label = "fast patch";
    message = m.fastPatch === null ? "n/a" : `${m.fastPatch}m`;
    color = m.fastPatch === null ? "gray" : (m.fastPatch <= 30 ? "green" : m.fastPatch <= 120 ? "orange" : "red");
  }

  res.json({ schemaVersion: 1, label, message, color });
});

// Badges SVG (minimal SVG shield)
app.get("/badges/:name.svg", (req, res) => {
  const { name } = req.params;
  const m = computeMetrics();
  let label = name;
  let message = "n/a";
  let color = "gray";
  if (name === "reproRate") {
    label = "repro rate";
    message = `${m.reproRate}%`;
    color = colorForPercent(m.reproRate);
  } else if (name === "defenderScore") {
    label = "defender score";
    message = `${m.defenderScore}`;
    color = colorForPercent(100 - m.defenderScore);
  } else if (name === "fastPatch") {
    label = "fast patch";
    message = m.fastPatch === null ? "n/a" : `${m.fastPatch}m`;
    color = m.fastPatch === null ? "gray" : (m.fastPatch <= 30 ? "green" : m.fastPatch <= 120 ? "orange" : "red");
  }
  const labelW = Math.max(40, label.length * 7);
  const msgW = Math.max(40, message.length * 7);
  const width = labelW + msgW;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${message}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <mask id="m"><rect width="${width}" height="20" rx="3" fill="#fff"/></mask>
  <g mask="url(#m)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${msgW}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelW/2}" y="14">${label}</text>
    <text x="${labelW + msgW/2}" y="14">${message}</text>
  </g>
</svg>`;
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(svg);
});

// Badges PNG (render the same SVG via sharp)
app.get("/badges/:name.png", async (req, res) => {
  const { name } = req.params;
  const m = computeMetrics();
  let label = name;
  let message = "n/a";
  let color = "gray";
  if (name === "reproRate") {
    label = "repro rate";
    message = `${m.reproRate}%`;
    color = colorForPercent(m.reproRate);
  } else if (name === "defenderScore") {
    label = "defender score";
    message = `${m.defenderScore}`;
    color = colorForPercent(100 - m.defenderScore);
  } else if (name === "fastPatch") {
    label = "fast patch";
    message = m.fastPatch === null ? "n/a" : `${m.fastPatch}m`;
    color = m.fastPatch === null ? "gray" : (m.fastPatch <= 30 ? "green" : m.fastPatch <= 120 ? "orange" : "red");
  }
  const labelW = Math.max(40, label.length * 7);
  const msgW = Math.max(40, message.length * 7);
  const width = labelW + msgW;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="20" role="img" aria-label="${label}: ${message}">
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <mask id="m"><rect width="${width}" height="20" rx="3" fill="#fff"/></mask>
  <g mask="url(#m)">
    <rect width="${labelW}" height="20" fill="#555"/>
    <rect x="${labelW}" width="${msgW}" height="20" fill="${color}"/>
    <rect width="${width}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelW/2}" y="14">${label}</text>
    <text x="${labelW + msgW/2}" y="14">${message}</text>
  </g>
</svg>`;
  try {
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    res.setHeader("Content-Type", "image/png");
    res.send(png);
  } catch (e) {
    res.status(500).json({ error: "badge render failed" });
  }
});

app.listen(8080, () => console.log("Referee API on :8080"));
