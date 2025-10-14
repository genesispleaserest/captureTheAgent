#!/usr/bin/env node

import { startWorker } from "./worker-repro.js";

// Start the worker with 5-second intervals
startWorker(5000).catch((error) => {
  console.error("Worker failed to start:", error);
  process.exit(1);
});













