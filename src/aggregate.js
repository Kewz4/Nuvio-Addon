import {
  classifyStream,
  isPlayableStream,
  languageRank,
} from "./classify.js";
import { assertPublicManifestHost } from "./config.js";
import { PROVIDER_BY_ID } from "./providers.js";

const DEFAULT_TIMEOUT_MS = 12_000;

export function buildUpstreamStreamUrl(manifestUrl, type, id) {
  const url = new URL(manifestUrl);
  url.pathname = `${url.pathname.slice(0, -"/manifest.json".length)}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`;
  url.hash = "";
  return url.toString();
}

async function fetchUpstream(
  providerConfig,
  type,
  id,
  { fetchImpl, timeoutMs, verifyUpstreamAddress },
) {
  const provider = PROVIDER_BY_ID.get(providerConfig.id);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerConfig.id}`);
  }

  const url = buildUpstreamStreamUrl(providerConfig.manifestUrl, type, id);
  if (verifyUpstreamAddress) {
    await assertPublicManifestHost(providerConfig.manifestUrl);
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("Upstream request timed out.")),
    timeoutMs,
  );

  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Nuvio-Simple-Streams/1.0",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > 5_000_000) {
      throw new Error("Response is too large.");
    }

    const payload = await response.json();
    return {
      provider,
      streams: Array.isArray(payload?.streams) ? payload.streams : [],
    };
  } finally {
    clearTimeout(timer);
  }
}

function simplifyStream(stream, classification, language) {
  const simplified = {
    ...stream,
    name: `${language} · ${classification.resolution}`,
  };

  delete simplified.title;
  delete simplified.description;

  if (
    simplified.behaviorHints &&
    typeof simplified.behaviorHints === "object"
  ) {
    const behaviorHints = { ...simplified.behaviorHints };
    delete behaviorHints.videoSize;

    if (Object.keys(behaviorHints).length > 0) {
      simplified.behaviorHints = behaviorHints;
    } else {
      delete simplified.behaviorHints;
    }
  }

  return simplified;
}

export async function aggregateStreams(
  config,
  type,
  id,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    verifyUpstreamAddress = false,
    onProviderError = () => {},
  } = {},
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A Fetch API implementation is required.");
  }

  const requests = config.providers.map((providerConfig) =>
    fetchUpstream(providerConfig, type, id, {
      fetchImpl,
      timeoutMs,
      verifyUpstreamAddress,
    }),
  );
  const results = await Promise.allSettled(requests);
  const candidates = [];

  results.forEach((result, index) => {
    const configuredProvider = config.providers[index];
    if (result.status === "rejected") {
      onProviderError(configuredProvider.id, result.reason);
      return;
    }

    result.value.streams.forEach((stream, sourceIndex) => {
      if (!isPlayableStream(stream)) {
        return;
      }

      const classification = classifyStream(stream, result.value.provider);
      if (!classification) {
        return;
      }

      classification.languages.forEach((language) => {
        candidates.push({
          provider: result.value.provider,
          sourceIndex,
          classification,
          language,
          languageRank: languageRank(language),
          stream,
        });
      });
    });
  });

  candidates.sort(
    (a, b) =>
      a.provider.priority - b.provider.priority ||
      a.classification.resolutionRank - b.classification.resolutionRank ||
      a.languageRank - b.languageRank ||
      a.sourceIndex - b.sourceIndex,
  );

  const seen = new Set();
  const selected = [];

  for (const candidate of candidates) {
    const key = [
      candidate.language,
      candidate.classification.resolution,
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    selected.push(
      simplifyStream(
        candidate.stream,
        candidate.classification,
        candidate.language,
      ),
    );
  }

  return selected;
}

export class ResponseCache {
  constructor(ttlMs = 60_000) {
    this.ttlMs = ttlMs;
    this.items = new Map();
  }

  get(key) {
    const item = this.items.get(key);
    if (!item) {
      return null;
    }
    if (item.expiresAt <= Date.now()) {
      this.items.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value) {
    this.items.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });

    if (this.items.size > 500) {
      const oldestKey = this.items.keys().next().value;
      this.items.delete(oldestKey);
    }
  }
}
