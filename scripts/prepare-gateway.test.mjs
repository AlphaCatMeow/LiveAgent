import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gatewayTarget, prepareGateway } from "./prepare-gateway.mjs";

test("sidecar targets retain Tauri triple naming and map to the Go architecture", () => {
  for (const [triple, goos, goarch, suffix] of [
    ["x86_64-pc-windows-msvc", "windows", "amd64", ".exe"],
    ["aarch64-pc-windows-msvc", "windows", "arm64", ".exe"],
    ["x86_64-apple-darwin", "darwin", "amd64", ""],
    ["aarch64-apple-darwin", "darwin", "arm64", ""],
    ["x86_64-unknown-linux-gnu", "linux", "amd64", ""],
    ["aarch64-unknown-linux-gnu", "linux", "arm64", ""],
  ]) {
    assert.deepEqual(gatewayTarget(triple), {
      triple, goos, goarch, filename: `liveagent-gateway-${triple}${suffix}`,
    });
  }
  assert.throws(() => gatewayTarget("universal-apple-darwin"), /Unsupported/);
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "liveagent 网关 build "));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, "crates", "agent-gateway", "web", "dist");
  await mkdir(dist, { recursive: true });
  return { root, index: join(dist, "index.html") };
}

test("build replaces stale WebUI before embedding and produces a sidecar in Unicode/space paths", async (t) => {
  const { root, index } = await fixture(t);
  await writeFile(index, "stale embed stub");
  const calls = [];
  const output = await prepareGateway({
    root, triple: "x86_64-pc-windows-msvc", env: { SENTINEL: "keep" },
    execute: async (command, args, options) => {
      calls.push(command.split(" ")[0]);
      if (command.startsWith("pnpm")) {
        assert.equal(options.cwd, root);
        await writeFile(index, '<script type="module" src="/assets/current.js"></script>');
      } else {
        assert.match(await readFile(index, "utf8"), /current.js/);
        assert.equal(options.env.GOOS, "windows");
        assert.equal(options.env.GOARCH, "amd64");
        assert.equal(options.env.CGO_ENABLED, "0");
        assert.equal(options.env.SENTINEL, "keep");
        await writeFile(args[args.indexOf("-o") + 1], "current binary");
      }
    },
  });
  assert.deepEqual(calls, ["pnpm", "go"]);
  assert.equal(await readFile(output, "utf8"), "current binary");
  assert.equal(output, join(root, "crates", "agent-gui", "src-tauri", "binaries", "liveagent-gateway-x86_64-pc-windows-msvc.exe"));
});

test("failed WebUI build or embed stub never reaches Go build", async (t) => {
  const { root, index } = await fixture(t);
  for (const failure of ["build", "stub"]) {
    const calls = [];
    await writeFile(index, "stub");
    await assert.rejects(prepareGateway({
      root, triple: "aarch64-apple-darwin",
      execute: async (command) => {
        calls.push(command.split(" ")[0]);
        if (failure === "build") throw new Error("typecheck failed");
      },
    }), failure === "build" ? /typecheck failed/ : /embed stub rejected/);
    assert.deepEqual(calls, ["pnpm"]);
  }
});

test("failed Go build does not replace a previously prepared sidecar", async (t) => {
  const { root, index } = await fixture(t);
  const output = join(root, "crates", "agent-gui", "src-tauri", "binaries", "liveagent-gateway-x86_64-unknown-linux-gnu");
  await mkdir(join(output, ".."), { recursive: true });
  await writeFile(output, "previous binary");
  await assert.rejects(prepareGateway({
    root, triple: "x86_64-unknown-linux-gnu",
    execute: async (command, args) => {
      if (command.startsWith("pnpm")) await writeFile(index, '<script src="/assets/new.js"></script>');
      else {
        await writeFile(args[args.indexOf("-o") + 1], "partial output");
        throw new Error("compiler failed");
      }
    },
  }), /compiler failed/);
  assert.equal(await readFile(output, "utf8"), "previous binary");
});
