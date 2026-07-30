import cinecalidad from "../vendor/nuvio-providers-latino/providers/cinecalidad.js";
import detodopeliculas from "../vendor/nuvio-providers-latino/providers/detodopeliculas.js";
import embed69 from "../vendor/nuvio-providers-latino/providers/embed69.js";
import hackstore from "../vendor/nuvio-providers-latino/providers/hackstore.js";
import lamovie from "../vendor/nuvio-providers-latino/providers/lamovie.js";
import peliserieshoy from "../vendor/nuvio-providers-latino/providers/peliserieshoy.js";
import seriesflix from "../vendor/nuvio-providers-latino/providers/seriesflix.js";
import seriesmetro from "../vendor/nuvio-providers-latino/providers/seriesmetro.js";
import xupalace from "../vendor/nuvio-providers-latino/providers/xupalace.js";
import zoowomaniacos from "../vendor/nuvio-providers-latino/providers/zoowomaniacos.js";

const TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

const LATINO_SCRAPERS = Object.freeze([
  {
    id: "cinecalidad",
    supportedTypes: ["movie"],
    getStreams: cinecalidad.getStreams,
  },
  {
    id: "embed69",
    supportedTypes: ["movie", "tv"],
    getStreams: embed69.getStreams,
  },
  {
    id: "zoowomaniacos",
    supportedTypes: ["movie"],
    getStreams: zoowomaniacos.getStreams,
  },
  {
    id: "xupalace",
    supportedTypes: ["movie", "tv"],
    getStreams: xupalace.getStreams,
  },
  {
    id: "seriesmetro",
    supportedTypes: ["movie", "tv"],
    getStreams: seriesmetro.getStreams,
  },
  {
    id: "peliserieshoy",
    supportedTypes: ["movie", "tv"],
    getStreams: peliserieshoy.getStreams,
  },
  {
    id: "seriesflix",
    supportedTypes: ["tv"],
    getStreams: seriesflix.getStreams,
  },
  {
    id: "detodopeliculas",
    supportedTypes: ["movie", "tv"],
    getStreams: detodopeliculas.getStreams,
  },
  {
    id: "lamovie",
    supportedTypes: ["movie", "tv"],
    getStreams: lamovie.getStreams,
  },
  {
    id: "hackstore",
    supportedTypes: ["movie", "tv"],
    getStreams: hackstore.getStreams,
  },
]);

const tmdbIdCache = new Map();

export function parsePluginRequest(type, id) {
  const mediaType = type === "series" ? "tv" : type;
  if (!["movie", "tv"].includes(mediaType)) {
    return null;
  }

  const parts = String(id ?? "").split(":");
  let sourceId = parts[0];
  let seasonIndex = 1;

  if (sourceId.toLocaleLowerCase("en") === "tmdb") {
    sourceId = parts[1] ?? "";
    seasonIndex = 2;
  } else if (sourceId.toLocaleLowerCase("en") === "imdb") {
    sourceId = parts[1] ?? "";
    seasonIndex = 2;
  }

  const tmdbId = /^\d+$/.test(sourceId) ? sourceId : null;
  const imdbId = /^tt\d+$/i.test(sourceId) ? sourceId : null;
  if (!tmdbId && !imdbId) {
    return null;
  }

  const season =
    mediaType === "tv" && /^\d+$/.test(parts[seasonIndex] ?? "")
      ? Number(parts[seasonIndex])
      : null;
  const episode =
    mediaType === "tv" && /^\d+$/.test(parts[seasonIndex + 1] ?? "")
      ? Number(parts[seasonIndex + 1])
      : null;

  return {
    mediaType,
    tmdbId,
    imdbId,
    season,
    episode,
  };
}

async function findTmdbId(imdbId, mediaType, fetchImpl) {
  const cacheKey = `${mediaType}:${imdbId}`;
  if (fetchImpl === globalThis.fetch && tmdbIdCache.has(cacheKey)) {
    return tmdbIdCache.get(cacheKey);
  }

  const lookup = (async () => {
    const url = new URL(
      `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}`,
    );
    url.searchParams.set("api_key", TMDB_API_KEY);
    url.searchParams.set("external_source", "imdb_id");

    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`TMDB lookup returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const results =
      mediaType === "movie" ? payload?.movie_results : payload?.tv_results;
    const tmdbId = Array.isArray(results) ? results[0]?.id : null;
    return Number.isInteger(tmdbId) || /^\d+$/.test(String(tmdbId ?? ""))
      ? String(tmdbId)
      : null;
  })();

  if (fetchImpl === globalThis.fetch) {
    tmdbIdCache.set(cacheKey, lookup);
  }

  try {
    return await lookup;
  } catch (error) {
    if (fetchImpl === globalThis.fetch) {
      tmdbIdCache.delete(cacheKey);
    }
    throw error;
  }
}

function withTimeout(promise, timeoutMs, scraperId) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${scraperId} timed out.`)),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function stringHeaders(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const headers = Object.fromEntries(
    Object.entries(value).filter(
      ([key, headerValue]) =>
        typeof key === "string" && typeof headerValue === "string",
    ),
  );
  return Object.keys(headers).length > 0 ? headers : null;
}

export function adaptPluginStream(result, scraperId) {
  if (!result || typeof result !== "object") {
    return null;
  }

  const url =
    typeof result.url === "string"
      ? result.url
      : typeof result.url?.url === "string"
        ? result.url.url
        : null;
  if (!url) {
    return null;
  }

  const details = [result.title, result.quality, result.language]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" · ");
  const headers = stringHeaders(result.headers);
  const stream = {
    name:
      typeof result.name === "string" && result.name.trim()
        ? result.name
        : scraperId,
    title: details || "Latino",
    url,
  };

  if (headers) {
    stream.behaviorHints = {
      proxyHeaders: {
        request: headers,
      },
    };
  }

  return stream;
}

export async function fetchLatinoPluginStreams(
  type,
  id,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 12_000,
    scrapers = LATINO_SCRAPERS,
    onScraperError = () => {},
  } = {},
) {
  const request = parsePluginRequest(type, id);
  if (!request || typeof fetchImpl !== "function") {
    return [];
  }

  const tmdbId =
    request.tmdbId ??
    (await findTmdbId(request.imdbId, request.mediaType, fetchImpl));
  if (!tmdbId) {
    return [];
  }

  const eligible = scrapers.filter(
    (scraper) =>
      scraper.supportedTypes.includes(request.mediaType) &&
      typeof scraper.getStreams === "function",
  );
  const results = await Promise.allSettled(
    eligible.map((scraper) =>
      withTimeout(
        Promise.resolve().then(() =>
          scraper.getStreams(
            tmdbId,
            request.mediaType,
            request.season,
            request.episode,
          ),
        ),
        timeoutMs,
        scraper.id,
      ),
    ),
  );

  return results.flatMap((result, index) => {
    const scraper = eligible[index];
    if (result.status === "rejected") {
      onScraperError(scraper.id, result.reason);
      return [];
    }

    return (Array.isArray(result.value) ? result.value : [])
      .map((stream) => adaptPluginStream(stream, scraper.id))
      .filter(Boolean);
  });
}
