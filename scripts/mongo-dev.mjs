import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "start" && mode !== "stop" && mode !== "status") {
  console.error("Usage: node scripts/mongo-dev.mjs <start|stop|status>");
  process.exit(2);
}

const PORT = 27018;
const REPL_SET = "rs0";
const DATA_DIR = resolve(".local", "mongo-data");
const LOG_FILE = resolve(".local", "mongo", "mongod.log");
const PID_FILE = resolve(".local", "mongo", "mongod.pid");
const HOST = `127.0.0.1:${PORT}`;

const MONGOD_CANDIDATES = [
  process.env.MONGOD_PATH,
  "C:/Program Files/MongoDB/Server/8.3/bin/mongod.exe",
  "C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe",
  "C:/Program Files/MongoDB/Server/7.0/bin/mongod.exe",
  "/usr/local/bin/mongod",
  "/usr/bin/mongod",
].filter(Boolean);

function resolveMongod() {
  const found = MONGOD_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    console.error("mongod was not found. Set MONGOD_PATH to your mongod executable.");
    process.exit(1);
  }
  return found;
}

function readPid() {
  if (!existsSync(PID_FILE)) return undefined;
  const raw = readFileSync(PID_FILE, "utf8").trim();
  if (!/^\d+$/.test(raw)) return undefined;
  return Number(raw);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readTopology() {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(`mongodb://${HOST}/?directConnection=true`, {
    serverSelectionTimeoutMS: 3000,
  });
  try {
    await client.connect();
    const admin = client.db("admin");
    const status = await admin.command({ replSetGetStatus: 1 }).catch(() => undefined);
    if (!status) return { reachable: true, initialized: false, isPrimary: false };
    const members = status.members ?? [];
    const self = members.find((member) => member.self) ?? members[0];
    return {
      reachable: true,
      initialized: true,
      set: status.set,
      isPrimary: self?.stateStr === "PRIMARY",
    };
  } catch {
    return { reachable: false, initialized: false, isPrimary: false };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function initiate() {
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(`mongodb://${HOST}/?directConnection=true`, {
    serverSelectionTimeoutMS: 10000,
  });
  try {
    await client.connect();
    await client.db("admin").command({
      replSetInitiate: { _id: REPL_SET, members: [{ _id: 0, host: HOST }] },
    });
  } catch (error) {
    if (!/already initialized/i.test(error.message)) throw error;
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function waitFor(fn, { attempts, delayMs, label }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await fn()) return true;
    await new Promise((done) => setTimeout(done, delayMs));
  }
  throw new Error(`${label} did not become ready.`);
}

async function start() {
  const running = readPid();
  if (running && isAlive(running)) {
    console.log(`MongoDB replica set already running (pid ${running}) on ${HOST}.`);
    return;
  }
  rmSync(PID_FILE, { force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(resolve(".local", "mongo"), { recursive: true });

  const child = spawn(
    resolveMongod(),
    [
      "--replSet",
      REPL_SET,
      "--port",
      String(PORT),
      "--bind_ip",
      "127.0.0.1",
      "--dbpath",
      DATA_DIR,
      "--logpath",
      LOG_FILE,
      "--logappend",
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once("spawn", resolveSpawn);
    child.once("error", rejectSpawn);
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));

  try {
    await waitFor(async () => (await readTopology()).reachable, {
      attempts: 60,
      delayMs: 500,
      label: "mongod",
    });

    const before = await readTopology();
    if (!before.initialized) await initiate();
    await waitFor(async () => (await readTopology()).isPrimary, {
      attempts: 60,
      delayMs: 500,
      label: `replica set ${REPL_SET} PRIMARY`,
    });
  } catch (error) {
    if (isAlive(child.pid)) process.kill(child.pid);
    rmSync(PID_FILE, { force: true });
    throw error;
  }

  console.log(`MongoDB replica set ${REPL_SET} is PRIMARY on ${HOST} (pid ${child.pid}).`);
  console.log(`Use MONGODB_URI=mongodb://${HOST}/nepal_hand_pay?replicaSet=${REPL_SET}`);
}

async function stop() {
  const pid = readPid();
  if (!pid || !isAlive(pid)) {
    rmSync(PID_FILE, { force: true });
    console.log("No project-local MongoDB replica set is running.");
    return;
  }
  const { MongoClient } = await import("mongodb");
  const client = new MongoClient(`mongodb://${HOST}/?directConnection=true`, {
    serverSelectionTimeoutMS: 3000,
  });
  try {
    await client.connect();
    await client.db("admin").command({ shutdown: 1, force: false, timeoutSecs: 10 });
  } catch {
    // A successful shutdown closes the connection before returning a response.
  } finally {
    await client.close().catch(() => undefined);
  }
  try {
    await waitFor(async () => !isAlive(pid), {
      attempts: 100,
      delayMs: 100,
      label: "mongod shutdown",
    });
  } catch (error) {
    if (isAlive(pid)) process.kill(pid);
    throw error;
  } finally {
    rmSync(PID_FILE, { force: true });
  }
  console.log(`Stopped MongoDB replica set (pid ${pid}).`);
}

async function status() {
  const pid = readPid();
  const topology = await readTopology();
  console.log(
    [
      `pid:      ${pid && isAlive(pid) ? pid : "not running"}`,
      `endpoint: ${HOST}`,
      `replica:  ${topology.initialized ? topology.set : "not initialized"}`,
      `primary:  ${topology.isPrimary}`,
    ].join("\n"),
  );
}

if (mode === "start") await start();
else if (mode === "stop") await stop();
else await status();
