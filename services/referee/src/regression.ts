import fs from "fs";
import { promises as fsPromises } from "fs";
import { join } from "path";

export function exportRegressionPack(run: any): string {
  const pack = {
    version: "1",
    seed: run.logs.find((l: any) => l.type === "seed")?.data,
    minimal_steps: run.logs.filter((l: any) => l.type === "step").map((s: any) => s.data),
    detectors: run.detectors
  };
  const path = `./artifacts/regression-${Date.now()}.json`;
  fs.mkdirSync("./artifacts", { recursive: true });
  fs.writeFileSync(path, JSON.stringify(pack, null, 2));
  return path;
}

export async function exportRegressionPackAsync(run: any): Promise<string> {
  const pack = {
    version: "1",
    seed: run.logs.find((l: any) => l.type === "seed")?.data,
    minimal_steps: run.logs.filter((l: any) => l.type === "step").map((s: any) => s.data),
    detectors: run.detectors,
    metadata: {
      exported_at: new Date().toISOString(),
      total_logs: run.logs.length,
      canary_hits: run.detectors.canary?.length || 0,
      external_requests: run.detectors.externalRequests?.length || 0,
      fixture_requests: run.detectors.fixtureRequests?.length || 0
    }
  };
  
  const timestamp = Date.now();
  const path = join("./artifacts", `regression-${timestamp}.json`);
  
  // Ensure artifacts directory exists
  await fsPromises.mkdir("./artifacts", { recursive: true });
  
  // Write the regression pack
  await fsPromises.writeFile(path, JSON.stringify(pack, null, 2));
  
  console.log(`[REGRESSION] Exported pack to ${path}`);
  return path;
}













