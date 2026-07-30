import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import vercelApp from "../api/index.js";
import defaultApp, { createApp } from "../src/server.js";

const fixedConfig = {
  providers: [
    {
      id: "progresoLatino",
      manifestUrl: "https://progreso.example/config/manifest.json",
    },
  ],
};

test("exports the Express application through the Vercel API entrypoint", () => {
  assert.equal(typeof defaultApp, "function");
  assert.equal(typeof defaultApp.listen, "function");
  assert.equal(vercelApp, defaultApp);
});

test("serves a valid manifest, simplified streams, CORS, and cache hits", async (t) => {
  let upstreamCalls = 0;
  const app = createApp({
    env: {
      CONFIG_SECRET: "a-long-integration-test-secret",
      CACHE_TTL_MS: "60000",
    },
    fixedConfig,
    fetchImpl: async () => {
      upstreamCalls += 1;
      return new Response(
        JSON.stringify({
          streams: [
            {
              name: "4K",
              description: "Latino",
              url: "https://play.example/movie",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    logger: { warn() {}, error() {} },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const manifestResponse = await fetch(`${baseUrl}/manifest.json`);
  const addonManifest = await manifestResponse.json();
  assert.equal(addonManifest.name, "Selección simple");
  assert.deepEqual(addonManifest.types, ["movie", "series"]);
  assert.equal(addonManifest.behaviorHints.configurationRequired, false);
  assert.equal(
    manifestResponse.headers.get("access-control-allow-origin"),
    "*",
  );

  const firstResponse = await fetch(
    `${baseUrl}/stream/movie/tt123.json`,
  );
  const firstPayload = await firstResponse.json();
  assert.equal(firstResponse.headers.get("x-simple-streams-cache"), "miss");
  assert.deepEqual(firstPayload.streams, [
    {
      name: "Latino · 4K",
      url: "https://play.example/movie",
    },
  ]);

  const secondResponse = await fetch(
    `${baseUrl}/stream/movie/tt123.json`,
  );
  assert.equal(secondResponse.headers.get("x-simple-streams-cache"), "hit");
  assert.equal(upstreamCalls, 1);
});

test("creates and serves an encrypted per-user manifest", async (t) => {
  const app = createApp({
    env: {
      CONFIG_SECRET: "another-long-integration-test-secret",
      PUBLIC_BASE_URL: "https://simple.example",
    },
    fixedConfig: null,
    logger: { warn() {}, error() {} },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const createResponse = await fetch(`${baseUrl}/api/configure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      peerflix: "https://peerflix.example/user/manifest.json",
    }),
  });
  const created = await createResponse.json();

  assert.equal(createResponse.status, 201);
  assert.match(
    created.manifestUrl,
    /^https:\/\/simple\.example\/c\/v1\./,
  );
  assert.match(created.stremioUrl, /^stremio:\/\/simple\.example\/c\/v1\./);

  const tokenPath = new URL(created.manifestUrl).pathname;
  const configuredManifestResponse = await fetch(`${baseUrl}${tokenPath}`);
  const configuredManifest = await configuredManifestResponse.json();
  assert.equal(configuredManifest.behaviorHints.configurationRequired, false);
});

test("returns friendly Spanish configuration errors", async (t) => {
  const app = createApp({
    env: {
      CONFIG_SECRET: "friendly-error-integration-test-secret",
    },
    fixedConfig: null,
    logger: { warn() {}, error() {} },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${baseUrl}/api/configure`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assert.equal(payload.error, "Agrega al menos una URL de manifest.json.");
});

test("uses the bundled household configuration by default", async (t) => {
  const app = createApp({
    env: {},
    fetchImpl: async () =>
      new Response(JSON.stringify({ streams: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    logger: { warn() {}, error() {} },
  });
  const server = app.listen(0);
  t.after(() => server.close());
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const statusResponse = await fetch(`${baseUrl}/api/status`);
  const status = await statusResponse.json();
  const manifestResponse = await fetch(`${baseUrl}/manifest.json`);
  const addonManifest = await manifestResponse.json();

  assert.equal(status.fixedAddonReady, true);
  assert.equal(status.fixedManifestUrl, `${baseUrl}/manifest.json`);
  assert.equal(
    status.spanishCinemetaManifestUrl,
    `${baseUrl}/cinemeta-es/manifest.json`,
  );
  assert.equal(addonManifest.behaviorHints.configurationRequired, false);

  const spanishManifestResponse = await fetch(
    `${baseUrl}/cinemeta-es/manifest.json`,
  );
  const spanishManifest = await spanishManifestResponse.json();
  assert.equal(spanishManifest.name, "Cinemeta en Español");
  assert.equal(spanishManifest.language, "es-419");
});
