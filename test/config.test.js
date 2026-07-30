import test from "node:test";
import assert from "node:assert/strict";
import {
  assertPublicManifestHost,
  decryptConfig,
  encryptConfig,
  loadEnvironmentConfig,
  normalizeConfig,
  validateManifestUrl,
} from "../src/config.js";

const secret = "this-is-a-long-test-only-configuration-secret";

test("normalizes providers in the required priority order", () => {
  const config = normalizeConfig({
    mediafusion: "https://media.example/user/manifest.json",
    progresoLatino: "https://progreso.example/config/manifest.json",
    peerflix: "",
    cometa: "https://cometa.example/manifest.json",
    latinoProviders:
      "https://raw.githubusercontent.com/example/plugin/manifest.json",
  });

  assert.deepEqual(
    config.providers.map((provider) => provider.id),
    ["progresoLatino", "cometa", "mediafusion", "latinoProviders"],
  );
});

test("encrypted configurations round-trip and reject tampering", () => {
  const config = normalizeConfig({
    progresoLatino: "https://progreso.example/config/manifest.json",
  });
  const token = encryptConfig(config, secret);

  assert.deepEqual(decryptConfig(token, secret), config);
  assert.throws(
    () => decryptConfig(`${token}x`, secret),
    /invalid|another deployment/i,
  );
});

test("requires a persistent, sufficiently long secret", () => {
  const config = normalizeConfig({
    peerflix: "https://peerflix.example/config/manifest.json",
  });

  assert.throws(() => encryptConfig(config, "short"), /at least 16/);
});

test("rejects unsafe or malformed manifest URLs", () => {
  assert.throws(
    () => validateManifestUrl("file:///tmp/manifest.json"),
    /HTTP or HTTPS/,
  );
  assert.throws(
    () => validateManifestUrl("http://127.0.0.1:7001/manifest.json"),
    /Private and local/,
  );
  assert.throws(
    () => validateManifestUrl("http://[::ffff:127.0.0.1]/manifest.json"),
    /Private and local/,
  );
  assert.throws(
    () => validateManifestUrl("https://example.com/configure"),
    /manifest\.json/,
  );
  assert.throws(
    () => validateManifestUrl("https://user:pass@example.com/manifest.json"),
    /credentials/,
  );
});

test("rejects hostnames that resolve to private addresses", async () => {
  await assert.rejects(
    () =>
      assertPublicManifestHost(
        "https://rebinding.example/manifest.json",
        async () => [{ address: "127.0.0.1", family: 4 }],
      ),
    /resolves to a private address/,
  );

  await assert.doesNotReject(() =>
    assertPublicManifestHost(
      "https://public.example/manifest.json",
      async () => [{ address: "93.184.216.34", family: 4 }],
    ),
  );
});

test("can explicitly allow local upstreams for self-hosting", () => {
  assert.equal(
    validateManifestUrl("http://127.0.0.1:7001/manifest.json", {
      allowPrivate: true,
    }),
    "http://127.0.0.1:7001/manifest.json",
  );
});

test("loads a fixed configuration from environment variables", () => {
  const config = loadEnvironmentConfig({
    PROGRESO_LATINO_URL: "https://progreso.example/manifest.json",
    MEDIAFUSION_URL: "https://media.example/manifest.json",
  });

  assert.deepEqual(
    config.providers.map((provider) => provider.id),
    ["progresoLatino", "mediafusion"],
  );
});
