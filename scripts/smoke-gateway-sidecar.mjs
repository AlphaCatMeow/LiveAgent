#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFile, chmod, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function unusedPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return port;
}

export async function smokeGateway(binary) {
  // Exercise the distributed executable from a path that catches shell quoting
  // and Unicode regressions. All runtime state belongs to this one invocation.
  const directory = await mkdtemp(join(tmpdir(), "LiveAgent 网关 smoke "));
  const executable = join(directory, process.platform === "win32" ? "liveagent-gateway.exe" : "liveagent-gateway");
  const token = randomUUID();
  const nonce = randomUUID();
  let child;
  let exited;
  let logs = "";
  try {
    await copyFile(binary, executable);
    if (process.platform !== "win32") await chmod(executable, 0o755);
    const port = await unusedPort();
    await mkdir(join(directory, "state"));
    child = spawn(executable, [], {
      cwd: directory,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // The distributed service must not discover Go, Node or pnpm at runtime.
        PATH: "",
        LIVEAGENT_GATEWAY_TOKEN: token,
        LIVEAGENT_GATEWAY_INSTANCE_NONCE: nonce,
        LIVEAGENT_GATEWAY_DESKTOP_PARENT: "1",
        LIVEAGENT_GATEWAY_HTTP_ADDR: `127.0.0.1:${port}`,
        LIVEAGENT_GATEWAY_DATA_DIR: join(directory, "state"),
        LIVEAGENT_GATEWAY_AGENT_DB: join(directory, "state", "gateway.db"),
        LIVEAGENT_GATEWAY_TLS_CERT: "",
        LIVEAGENT_GATEWAY_TLS_KEY: "",
      },
    });
    exited = new Promise((resolveExit) => {
      child.once("error", (error) => resolveExit({ error }));
      child.once("exit", (code, signal) => resolveExit({ code, signal }));
    });
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8").on("data", (chunk) => { logs = (logs + chunk).slice(-16_384); });
    }
    const url = `http://127.0.0.1:${port}`;
    let ready = false;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error("Gateway exited before readiness");
      try {
        const response = await fetch(`${url}/healthz`, {
          headers: { "X-LiveAgent-Instance-Probe": createHash("sha256").update(nonce).digest("hex") },
          signal: AbortSignal.timeout(1_000),
        });
        if (response.ok) {
          assert.deepEqual(await response.json(), { ok: true });
          assert.equal(response.headers.get("X-LiveAgent-Instance"), nonce);
          ready = true;
          break;
        }
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
      await sleep(100);
    }
    assert.ok(ready, "Gateway health timeout");
    for (const headers of [{}, { "X-LiveAgent-Instance-Probe": "incorrect-probe" }]) {
      const response = await fetch(`${url}/healthz`, { headers, signal: AbortSignal.timeout(2_000) });
      assert.equal(response.headers.get("X-LiveAgent-Instance"), null, "instance identity must require the launch probe");
    }
    const status = await fetch(`${url}/api/status`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_000),
    });
    assert.equal(status.status, 200, "owned Gateway must accept its generated token");
    const page = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(page.headers.get("content-type"), /text\/html/);
    const entry = /<script\b[^>]*\bsrc=["']([^"']+\.js)["']/i.exec(html)?.[1];
    assert.ok(entry, "packaged WebUI must contain a real JavaScript entry, not an embed stub");
    const asset = await fetch(new URL(entry, url), { signal: AbortSignal.timeout(5_000) });
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type"), /javascript/);
    assert.ok((await asset.text()).length > 100, "embedded WebUI JavaScript must not be empty");
    assert.ok(!logs.includes(token), "Gateway logs exposed its authentication token");

    // EOF models the desktop dying or being restarted by Tauri's Rust watcher.
    // The Gateway must exit itself rather than rely on the parent's exit hook.
    child.stdin.end();
    const parentExit = await Promise.race([exited, sleep(5_000).then(() => null)]);
    assert.ok(parentExit, "Gateway did not stop within five seconds after desktop stdin EOF");
    assert.equal(parentExit.code, 0, "Gateway must shut down gracefully when its desktop parent disappears");
    await assert.rejects(fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000) }), "Gateway still listens after parent EOF");
    // On Windows this also proves SQLite's handles were released after exit.
    const db = join(directory, "state", "gateway.db");
    await rename(db, `${db}.closed`);
    await rename(`${db}.closed`, db);
    console.log(`Gateway sidecar smoke passed: ${basename(binary)} (health, launch identity, authenticated API, embedded WebUI, Unicode/space path, empty PATH, parent EOF cleanup)`);
  } catch (error) {
    // Redact credentials even if the underlying executable logs unexpectedly.
    const safeLogs = logs.replaceAll(token, "[REDACTED]").replaceAll(nonce, "[REDACTED]");
    throw new Error(`${error.message}\n${safeLogs}`, { cause: error });
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill();
      const result = await Promise.race([exited, sleep(5_000).then(() => null)]);
      if (!result) {
        child.kill("SIGKILL");
        await exited;
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function main(args) {
  let binary = args[0] && resolve(args[0]);
  if (args.length > 1) throw new Error("Usage: node scripts/smoke-gateway-sidecar.mjs [native-sidecar-path]");
  if (!binary) {
    const binariesDir = join(root, "crates", "agent-gui", "src-tauri", "binaries");
    const candidates = (await readdir(binariesDir)).filter((name) => name.startsWith("liveagent-gateway-") && !name.endsWith(".tmp"));
    if (candidates.length !== 1) throw new Error("Pass the native sidecar path when more than one target has been prepared");
    binary = join(binariesDir, candidates[0]);
  }
  await smokeGateway(binary);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`smoke-gateway-sidecar: ${error.message}`);
    process.exitCode = 1;
  });
}
