import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { aggregateStreams, ResponseCache } from "./aggregate.js";
import { BUNDLED_PROVIDER_URLS } from "./bundled-config.js";
import {
  fetchSpanishCatalog,
  fetchSpanishMeta,
  spanishCinemetaManifest,
} from "./cinemeta-es.js";
import {
  allowPrivateUpstreamsFromEnv,
  decryptConfig,
  encryptConfig,
  loadEnvironmentConfig,
  normalizeConfig,
} from "./config.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(moduleDirectory, "../public");

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requestBaseUrl(request, env) {
  if (env.PUBLIC_BASE_URL) {
    return String(env.PUBLIC_BASE_URL).replace(/\/+$/, "");
  }
  return `${request.protocol}://${request.get("host")}`;
}

function manifest(baseUrl, { configured }) {
  return {
    id: "community.nuvio-simple-streams",
    version: "1.1.0",
    name: "Selección simple",
    description:
      "Una sola opción por idioma y resolución, con Latino Providers para completar opciones faltantes.",
    logo: `${baseUrl}/icon.svg`,
    resources: [
      {
        name: "stream",
        types: ["movie", "series"],
      },
    ],
    types: ["movie", "series"],
    catalogs: [],
    language: "es",
    behaviorHints: {
      configurable: !configured,
      configurationRequired: !configured,
    },
  };
}

function configurationCacheKey(prefix, config, type, id) {
  return `${prefix}\u0000${JSON.stringify(config)}\u0000${type}\u0000${id}`;
}

function localizedConfigurationError(error) {
  const message = String(error?.message ?? "");
  if (message === "Add at least one upstream manifest URL.") {
    return "Agrega al menos una URL de manifest.json.";
  }
  if (message.includes("not a valid URL")) {
    return "Una de las URLs no es válida.";
  }
  if (message.includes("must use HTTP or HTTPS")) {
    return "Las URLs deben comenzar con http:// o https://.";
  }
  if (message.includes("cannot contain URL credentials")) {
    return "Las URLs no pueden incluir usuario o contraseña.";
  }
  if (message.includes("Private and local upstream")) {
    return "Este servidor no permite direcciones privadas o locales.";
  }
  if (message.includes("must end in /manifest.json")) {
    return "Cada URL debe terminar en /manifest.json.";
  }
  return message || "No se pudo guardar la configuración.";
}

export function createApp({
  env = process.env,
  fetchImpl = globalThis.fetch,
  fixedConfig = undefined,
  logger = console,
} = {}) {
  const app = express();
  const allowPrivate = allowPrivateUpstreamsFromEnv(env);
  const configuredFromEnvironment =
    fixedConfig === undefined
      ? (loadEnvironmentConfig(env, { allowPrivate }) ??
        normalizeConfig(BUNDLED_PROVIDER_URLS, { allowPrivate }))
      : fixedConfig;
  const timeoutMs = parsePositiveNumber(env.UPSTREAM_TIMEOUT_MS, 12_000);
  const cache = new ResponseCache(
    parsePositiveNumber(env.CACHE_TTL_MS, 60_000),
  );
  const cinemetaCatalogCache = new ResponseCache(
    parsePositiveNumber(env.CINEMETA_CATALOG_CACHE_TTL_MS, 30 * 60_000),
  );
  const cinemetaMetaCache = new ResponseCache(
    parsePositiveNumber(env.CINEMETA_META_CACHE_TTL_MS, 6 * 60 * 60_000),
  );

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use((request, response, next) => {
    response.set({
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "64kb" }));
  app.use(
    express.static(publicDirectory, {
      extensions: ["html"],
      maxAge: env.NODE_ENV === "production" ? "1h" : 0,
    }),
  );

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  app.get("/api/status", (request, response) => {
    response.set("cache-control", "no-store");
    response.json({
      configurationEnabled: Boolean(
        env.CONFIG_SECRET && String(env.CONFIG_SECRET).length >= 16,
      ),
      fixedAddonReady: Boolean(configuredFromEnvironment),
      fixedManifestUrl: configuredFromEnvironment
        ? `${requestBaseUrl(request, env)}/manifest.json`
        : null,
      spanishCinemetaManifestUrl: `${requestBaseUrl(request, env)}/cinemeta-es/manifest.json`,
    });
  });

  app.post("/api/configure", (request, response) => {
    response.set("cache-control", "no-store");
    try {
      const config = normalizeConfig(request.body, { allowPrivate });
      const token = encryptConfig(config, env.CONFIG_SECRET);
      const manifestUrl = `${requestBaseUrl(request, env)}/c/${token}/manifest.json`;
      response.status(201).json({
        manifestUrl,
        stremioUrl: manifestUrl.replace(/^https?:\/\//i, "stremio://"),
      });
    } catch (error) {
      const unavailable =
        String(error?.message).startsWith("CONFIG_SECRET must contain");
      response.status(unavailable ? 503 : 400).json({
        error: unavailable
          ? "This deployment has not enabled private configuration links."
          : localizedConfigurationError(error),
      });
    }
  });

  app.get("/manifest.json", (request, response) => {
    response.set("cache-control", "public, max-age=300");
    response.json(
      manifest(requestBaseUrl(request, env), {
        configured: Boolean(configuredFromEnvironment),
      }),
    );
  });

  app.get("/cinemeta-es/manifest.json", (request, response) => {
    response.set("cache-control", "public, max-age=3600");
    response.json(
      spanishCinemetaManifest(requestBaseUrl(request, env)),
    );
  });

  async function sendSpanishCatalog(request, response, next) {
    const { type, catalogId } = request.params;
    const extra = request.params.extra ?? "";
    const cacheKey = `${type}\u0000${catalogId}\u0000${extra}`;
    const cached = cinemetaCatalogCache.get(cacheKey);
    if (cached) {
      response.set("x-cinemeta-es-cache", "hit");
      response.set("cache-control", "public, max-age=300");
      response.json(cached);
      return;
    }

    try {
      const payload = await fetchSpanishCatalog(type, catalogId, extra, {
        fetchImpl,
        tmdbApiKey: env.TMDB_API_KEY,
      });
      if (!payload) {
        response.status(404).json({ error: "Catálogo no encontrado." });
        return;
      }

      cinemetaCatalogCache.set(cacheKey, payload);
      response.set("x-cinemeta-es-cache", "miss");
      response.set("cache-control", "public, max-age=300");
      response.json(payload);
    } catch (error) {
      next(error);
    }
  }

  app.get(
    "/cinemeta-es/catalog/:type/:catalogId.json",
    sendSpanishCatalog,
  );
  app.get(
    "/cinemeta-es/catalog/:type/:catalogId/:extra.json",
    sendSpanishCatalog,
  );

  app.get(
    "/cinemeta-es/meta/:type/:id.json",
    async (request, response, next) => {
      const { type, id } = request.params;
      const cacheKey = `${type}\u0000${id}`;
      const cached = cinemetaMetaCache.get(cacheKey);
      if (cached) {
        response.set("x-cinemeta-es-cache", "hit");
        response.set("cache-control", "public, max-age=3600");
        response.json(cached);
        return;
      }

      try {
        const payload = await fetchSpanishMeta(type, id, {
          fetchImpl,
          tmdbApiKey: env.TMDB_API_KEY,
        });
        if (!payload) {
          response.status(404).json({ error: "Metadatos no encontrados." });
          return;
        }

        cinemetaMetaCache.set(cacheKey, payload);
        response.set("x-cinemeta-es-cache", "miss");
        response.set("cache-control", "public, max-age=3600");
        response.json(payload);
      } catch (error) {
        next(error);
      }
    },
  );

  async function sendStreams(request, response, config, cachePrefix) {
    if (!config) {
      response.set("cache-control", "no-store");
      response.json({ streams: [] });
      return;
    }

    const { type, id } = request.params;
    const cacheKey = configurationCacheKey(cachePrefix, config, type, id);
    const cached = cache.get(cacheKey);
    if (cached) {
      response.set("x-simple-streams-cache", "hit");
      response.set("cache-control", "public, max-age=30");
      response.json({ streams: cached });
      return;
    }

    const streams = await aggregateStreams(config, type, id, {
      fetchImpl,
      timeoutMs,
      verifyUpstreamAddress:
        !allowPrivate && fetchImpl === globalThis.fetch,
      onProviderError(providerId, error) {
        logger.warn?.(
          `[streams] ${providerId} failed for ${type}/${id}: ${error?.message ?? error}`,
        );
      },
    });
    cache.set(cacheKey, streams);
    response.set("x-simple-streams-cache", "miss");
    response.set("cache-control", "public, max-age=30");
    response.json({ streams });
  }

  app.get("/stream/:type/:id.json", async (request, response, next) => {
    try {
      await sendStreams(
        request,
        response,
        configuredFromEnvironment,
        "environment",
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/c/:token/manifest.json", (request, response) => {
    response.set("cache-control", "private, max-age=300");
    try {
      decryptConfig(request.params.token, env.CONFIG_SECRET, { allowPrivate });
      response.json(
        manifest(requestBaseUrl(request, env), {
          configured: true,
        }),
      );
    } catch (error) {
      response.status(404).json({ error: error.message });
    }
  });

  app.get(
    "/c/:token/stream/:type/:id.json",
    async (request, response, next) => {
      try {
        const config = decryptConfig(request.params.token, env.CONFIG_SECRET, {
          allowPrivate,
        });
        await sendStreams(request, response, config, request.params.token);
      } catch (error) {
        if (
          String(error?.message).startsWith("The configuration link") ||
          String(error?.message).startsWith("CONFIG_SECRET")
        ) {
          response.status(404).json({ error: error.message });
          return;
        }
        next(error);
      }
    },
  );

  app.use((error, _request, response, _next) => {
    logger.error?.(error);
    response.status(500).json({
      error: "The simplified stream list could not be created.",
    });
  });

  return app;
}

const app = createApp();
export default app;

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedFile === fileURLToPath(import.meta.url)) {
  const port = parsePositiveNumber(process.env.PORT, 7000);
  app.listen(port, () => {
    console.log(`Nuvio Simple Streams is listening on http://127.0.0.1:${port}`);
  });
}
