import { z } from "zod";

export const PolicyManifest = z.object({
  agent_id: z.string(),
  capabilities: z.array(z.string()),
  limits: z.object({
    max_order_usd: z.number().default(50),
    pii_output: z.enum(["deny","mask"]).default("deny"),
    jurisdictions_blocklist: z.array(z.string()).default([]),
  }),
  forbid: z.array(z.string()).default([]),
});
export type PolicyManifest = z.infer<typeof PolicyManifest>;

export const ViolationSchema = z.object({
  kind: z.enum(["PII_EXFIL","JAILBREAK","SPEND_CAP","PRIV_ESC","PROMPT_INJECTION"]),
  evidence: z.array(z.string()), // hashes, canary IDs, snippets
});
export type Violation = z.infer<typeof ViolationSchema>;
export const Violation = ViolationSchema;

export const AttackClaim = z.object({
  session_id: z.string(),
  transcript: z.array(z.object({ role:z.enum(["user","agent"]), content:z.string() })),
  artifacts: z.array(z.string()).default([]),
  alleged: z.array(ViolationSchema.shape.kind),
});
export type AttackClaim = z.infer<typeof AttackClaim>;
