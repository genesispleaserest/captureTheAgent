import type { Violation } from "./types.js";

export function detectCanary(canaries: string[], text: string): Violation[] {
  const hits = canaries.filter(c => text.includes(c));
  if (!hits.length) return [];
  const violation: Violation = { kind: "PII_EXFIL", evidence: hits };
  return [violation];
}

export function detectPolicyJailbreak(output: string, forbid: string[]): Violation[] {
  const hits = forbid.filter(f => output.toLowerCase().includes(f.toLowerCase()));
  if (!hits.length) return [];
  const violation: Violation = { kind: "JAILBREAK", evidence: hits };
  return [violation];
}

export function detectSpendCap(total: number, cap: number): Violation[] {
  if (total <= cap) return [];
  const violation: Violation = { kind: "SPEND_CAP", evidence: [`spent:${total}`] };
  return [violation];
}












