import mongoose from "mongoose";
import { config } from "./config.js";
import { reconcileLedger } from "./services/reconciliation.js";

async function run() {
  await mongoose.connect(config.MONGODB_URI);
  const report = await reconcileLedger();
  console.log(JSON.stringify(report, null, 2));
  await mongoose.disconnect();
  if (!report.balanced) process.exitCode = 1;
}

run().catch(async (error) => {
  console.error(
    JSON.stringify({
      balanced: false,
      error: error instanceof Error ? error.message : "unknown",
    }),
  );
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
