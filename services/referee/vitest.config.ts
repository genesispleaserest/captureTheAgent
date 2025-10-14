import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.{spec,test}.ts"],
    globals: true,
    clearMocks: true,
    restoreMocks: true
  }
});
