import { fileURLToPath } from "node:url";
import "./node-user-info-shim.cjs";

// tsx spawns a child process in watch mode. Preload the fallback there too.
const shimPath = fileURLToPath(new URL("./node-user-info-shim.cjs", import.meta.url));
const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
process.env.NODE_OPTIONS = [existingNodeOptions, `--require=${shimPath}`]
  .filter(Boolean)
  .join(" ");

await import("tsx/cli");
