import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const panel = loader.loadModule("src/components/project-tools/SshTunnelPanel.tsx");
const forwarding = loader.loadModule("src/lib/terminal/sshLocalForwardTypes.ts");

function host(overrides = {}) {
  return {
    id: "host-1",
    name: "Production",
    description: "",
    host: "prod.example.com",
    port: 22,
    username: "deploy",
    authType: "password",
    password: "",
    passwordConfigured: false,
    privateKey: "",
    privateKeyPath: "",
    privateKeyConfigured: false,
    privateKeyPassphrase: "",
    privateKeyPassphraseConfigured: false,
    proxy: {
      type: "socks5",
      url: "",
      port: 0,
      username: "",
      password: "",
      passwordConfigured: false,
    },
    ...overrides,
  };
}

test("SSH tunnel panel treats keyboard-interactive hosts as credential ready", () => {
  const keyboardInteractiveHost = host({
    authType: "keyboardInteractive",
    passwordConfigured: false,
    privateKeyConfigured: false,
  });

  assert.equal(panel.hostSecretReady(keyboardInteractiveHost), true);
  assert.equal(panel.hostStatusMessage(keyboardInteractiveHost, (key) => key), "");
});

test("SSH tunnel panel does not disable hosts only because proxy is configured", () => {
  const proxyHost = host({
    passwordConfigured: true,
    proxy: {
      type: "http",
      url: "http://127.0.0.1",
      port: 8080,
      username: "proxy-user",
      password: "",
      passwordConfigured: true,
    },
  });

  assert.equal(panel.hostStatusMessage(proxyHost, (key) => key), "");
});

test("SSH local forwarding validates remote host and port", () => {
  assert.deepEqual(forwarding.validateSshLocalForwardTarget(" db.internal ", "5432"), {
    remoteHost: "db.internal",
    remotePort: 5432,
  });
  assert.equal(forwarding.validateSshLocalForwardTarget("", "5432"), null);
  assert.equal(forwarding.validateSshLocalForwardTarget("db\ninternal", "5432"), null);
  assert.equal(forwarding.validateSshLocalForwardTarget("db.internal", "0"), null);
  assert.equal(forwarding.validateSshLocalForwardTarget("db.internal", "65536"), null);
  assert.equal(forwarding.validateSshLocalForwardTarget("db.internal", "not-a-port"), null);
});

test("SSH local forwarding normalizes Tauri responses", async () => {
  const clientLoader = createTsModuleLoader({
    mocks: {
      "@tauri-apps/api/core": {
        async invoke(command) {
          assert.equal(command, "terminal_ssh_local_forward_list");
          return {
            forwards: [
              {
                id: "forward-1",
                session_id: "ssh-1",
                project_path_key: "/project",
                local_host: "127.0.0.1",
                local_port: 49152,
                address: "127.0.0.1:49152",
                remote_host: "db.internal",
                remote_port: 5432,
                status: "active",
                created_at: 1,
                updated_at: 2,
              },
            ],
            revision: 3,
          };
        },
      },
      "@tauri-apps/api/event": {
        async listen() {
          return () => undefined;
        },
      },
    },
  });
  const tauriForwarding = clientLoader.loadModule(
    "src/lib/terminal/tauriSshLocalForwardClient.ts",
  );

  const snapshot = await tauriForwarding.tauriSshLocalForwardClient.list();

  assert.equal(snapshot.revision, 3);
  assert.deepEqual(snapshot.forwards[0], {
    id: "forward-1",
    sessionId: "ssh-1",
    projectPathKey: "/project",
    localHost: "127.0.0.1",
    localPort: 49152,
    address: "127.0.0.1:49152",
    remoteHost: "db.internal",
    remotePort: 5432,
    status: "active",
    createdAt: 1,
    updatedAt: 2,
    error: undefined,
  });
});

test("SSH local forwarding ignores stale revisions and applies stop once", () => {
  const forward = {
    id: "forward-1",
    sessionId: "ssh-1",
    projectPathKey: "/project",
    localHost: "127.0.0.1",
    localPort: 49152,
    address: "127.0.0.1:49152",
    remoteHost: "127.0.0.1",
    remotePort: 5432,
    status: "active",
    createdAt: 1,
    updatedAt: 1,
  };
  const started = forwarding.reduceSshLocalForwardState(
    { forwards: [], revision: 0 },
    { kind: "started", forward, revision: 1 },
  );
  assert.deepEqual(started.forwards, [forward]);
  assert.equal(
    forwarding.reduceSshLocalForwardState(started, { forwards: [], revision: 0 }),
    started,
  );
  const stopped = forwarding.reduceSshLocalForwardState(started, {
    kind: "stopped",
    forward: { ...forward, status: "stopped" },
    revision: 2,
  });
  assert.deepEqual(stopped, { forwards: [], revision: 2 });
  assert.equal(
    forwarding.reduceSshLocalForwardState(stopped, {
      kind: "stopped",
      forward: { ...forward, status: "stopped" },
      revision: 2,
    }),
    stopped,
  );
});
