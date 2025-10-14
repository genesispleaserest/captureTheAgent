export function score({ impact, exploitability, confidence, novelty }: {
  impact: number; 
  exploitability: number; 
  confidence: number; 
  novelty: number;
}): number {
  const clamp = (n: number) => Math.max(0, Math.min(10, n));
  const s = 0.5 * clamp(impact) + 0.3 * clamp(exploitability) + 0.15 * clamp(novelty) + 0.05 * clamp(confidence * 10);
  return Math.round(s * 10) / 10; // 0..10
}













