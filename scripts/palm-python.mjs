import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

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
const args = mode === "test"
  ? [...prefix, "-m", "pytest", "services/palm-recognition/tests"]
  : [...prefix, "-m", "uvicorn", "app.main:app", "--app-dir", "services/palm-recognition", "--reload", "--port", "8001"];

const child = spawn(command, args, { stdio: "inherit", shell: false });
child.on("error", (error) => {
  console.error(`Palm service Python failed to start: ${error.message}`);
  console.error("Create .venv and install services/palm-recognition/requirements.txt.");
  process.exit(1);
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
