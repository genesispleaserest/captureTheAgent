import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export function createTempDbPath(prefix: string = "arena-test"): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const dbPath = join(dir, "arena.db");

  return {
    path: dbPath,
    cleanup: () => {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors in tests
      }
    }
  };
}
