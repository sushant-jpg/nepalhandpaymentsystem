import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "test") {
  console.error("Usage: node scripts/palm-python.mjs <dev|test>");
  process.exit(2);
}

const localPython = process.platform === "win32"
  ? resolve(".venv", "Scripts", "python.exe")
  : resolve(".venv", "bin", "python");
const command = existsSync(localPython) ? localPython : process.platform === "win32" ? "py" : "python3";
const prefix = command === "py" ? ["-3"] : [];
const testTemp = resolve(".test-tmp", `palm-${process.pid}-${Date.now()}`);
const localKeyFile = resolve(".local", "palm-template-encryption.key");

function getDevelopmentEncryptionKey() {
  const configured = process.env.PALM_TEMPLATE_ENCRYPTION_KEY?.trim();
  if (configured) return configured;
  if (existsSync(localKeyFile)) return readFileSync(localKeyFile, "utf8").trim();

  mkdirSync(dirname(localKeyFile), { recursive: true });
  const generated = randomBytes(32).toString("base64url") + "=";
  writeFileSync(localKeyFile, `${generated}\n`, { encoding: "utf8", mode: 0o600 });
  console.log(`Generated a persistent local palm encryption key in ${localKeyFile}.`);
  return generated;
}

const childEnvironment = mode === "test"
  ? {
      ...process.env,
      PALM_ENVIRONMENT: "test",
      PALM_SERVICE_KEY: "test-palm-service-key-at-least-32-characters",
      PALM_TEMPLATE_ENCRYPTION_KEY: "nJ7StPpwWJgYr6B-gsFGHxKFyuw1PyomSnQlHDEMLqA=",
    }
  : {
      ...process.env,
      PALM_ENVIRONMENT: "development",
      PALM_TEMPLATE_ENCRYPTION_KEY: getDevelopmentEncryptionKey(),
    };

const args = mode === "test"
  ? [...prefix, "-m", "pytest", "-p", "no:cacheprovider", `--basetemp=${testTemp}`, "services/palm-recognition/tests"]
  : [...prefix, "-m", "uvicorn", "app.main:app", "--app-dir", "services/palm-recognition", "--reload", "--port", "8001"];

const child = spawn(command, args, {
  stdio: "inherit",
  shell: false,
  env: childEnvironment,
});
child.on("error", (error) => {
  console.error(`Palm service Python failed to start: ${error.message}`);
  console.error("Create .venv and install services/palm-recognition/requirements.txt.");
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (mode === "test" && dirname(testTemp) === resolve(".test-tmp")) {
    try {
      rmSync(testTemp, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch {
      // The path is ignored and unique; a later cleanup can remove it safely.
    }
  }
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
