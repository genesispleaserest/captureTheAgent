import express from "express";
import { randomUUID as uuid } from "crypto";
import { PolicyManifest, AttackClaim } from "@arena/core";
import cors from "cors";
import { getDatabase } from "./db.js";

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
    return res.status(429).json({ error: "Too Many Requests" });
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
      return res.status(429).json({ error: "Too Many Requests" });
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
app.post("/sessions", sessionsLimiter, (req, res) => {
  const parse = PolicyManifest.safeParse(req.body.policy);
  if (!parse.success) return res.status(400).json(parse.error);
  const id = uuid();
  const seed = req.body.seed ?? Date.now();
  sessions.set(id, { id, policy: parse.data, seed, created: Date.now() });

  const stmt = db.prepare(`
    INSERT INTO sessions (id, policy, seed)
    VALUES (?, ?, ?)
  `);
  stmt.run(id, JSON.stringify(parse.data), seed);
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
app.post("/claims", claimsLimiter, async (req, res) => {
  const parse = AttackClaim.safeParse(req.body);
  if (!parse.success) return res.status(400).json(parse.error);
  
  // Save claim to database
  const claimId = uuid();
  const stmt = db.prepare(`
    INSERT INTO claims (id, session_id, transcript, artifacts, alleged, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `);
  stmt.run(
    claimId,
    parse.data.session_id,
    JSON.stringify(parse.data.transcript),
    JSON.stringify(parse.data.artifacts),
    JSON.stringify(parse.data.alleged)
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
      c.session_id
    FROM verdicts v
    JOIN claims c ON v.claim_id = c.id
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
  }>;

  const baseUrl = `${req.protocol}://${req.get("host")}`;

  const recent_kills = recentRows.map((row) => {
    const cleanedPath = row.regression_path?.replace(/^\.\//, "") ?? null;
    const normalizedPath = cleanedPath?.replace(/^\\/, "");
    const regression_url = normalizedPath ? `${baseUrl}/${normalizedPath.replace(/^\//, "")}` : null;

    return {
      verdict_id: row.id,
      claim_id: row.claim_id,
      session_id: row.session_id,
      severity: row.severity,
      created_at: row.created_at,
      regression_path: row.regression_path,
      regression_url
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
      c.status as claim_status
    FROM verdicts v
    JOIN claims c ON v.claim_id = c.id
    WHERE v.claim_id = ?
  `);
  
  const verdict = stmt.get(claimId) as any;
  
  if (!verdict) {
    return res.status(404).json({ error: "Verdict not found" });
  }
  
  res.json({
    verdict_id: verdict.id,
    claim_id: verdict.claim_id,
    reproduced: Boolean(verdict.reproduced),
    severity: verdict.severity,
    regression_path: verdict.regression_path,
    created_at: verdict.created_at,
    claim_status: verdict.claim_status
  });
});

app.listen(8080, () => console.log("Referee API on :8080"));
