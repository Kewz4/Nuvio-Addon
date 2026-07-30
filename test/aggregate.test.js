import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateStreams,
  buildUpstreamStreamUrl,
  ResponseCache,
} from "../src/aggregate.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("builds the stream endpoint while preserving configured query data", () => {
  assert.equal(
    buildUpstreamStreamUrl(
      "https://addon.example/user-key/manifest.json?token=abc",
      "series",
      "tt123:2:7",
    ),
    "https://addon.example/user-key/stream/series/tt123%3A2%3A7.json?token=abc",
  );
});

test("deduplicates language/resolution combinations by provider priority", async () => {
  const config = {
    providers: [
      {
        id: "progresoLatino",
        manifestUrl: "https://progreso.example/config/manifest.json",
      },
      {
        id: "peerflix",
        manifestUrl: "https://peerflix.example/config/manifest.json",
      },
      {
        id: "cometa",
        manifestUrl: "https://cometa.example/config/manifest.json",
      },
      {
        id: "mediafusion",
        manifestUrl: "https://media.example/config/manifest.json",
      },
    ],
  };
  const payloads = new Map([
    [
      "progreso.example",
      {
        streams: [
          {
            name: "4K",
            description: "Toy Story 5\nLatino",
            url: "https://play.example/progreso-4k",
            behaviorHints: { filename: "toy-story-5-2160p.mkv" },
          },
          {
            name: "FHD",
            description: "Toy Story 5\nLatino",
            url: "https://play.example/progreso-1080",
          },
        ],
      },
    ],
    [
      "peerflix.example",
      {
        streams: [
          {
            name: "Peerflix 2160p",
            description: "Latino",
            url: "https://play.example/lower-priority-latino",
          },
          {
            name: "Peerflix 2160p",
            description: "Castellano",
            infoHash: "peerflix-castellano",
            fileIdx: 3,
          },
        ],
      },
    ],
    [
      "cometa.example",
      {
        streams: [
          {
            name: "Comet 2160p",
            description: "🌎/GB/ES",
            url: "https://play.example/cometa-multi",
          },
        ],
      },
    ],
    [
      "media.example",
      {
        streams: [
          {
            name: "MediaFusion 4K",
            description: "English + Spanish",
            url: "https://play.example/lower-priority-multi",
          },
        ],
      },
    ],
  ]);
  const requested = [];

  const streams = await aggregateStreams(config, "movie", "tt123", {
    fetchImpl: async (url) => {
      requested.push(url);
      return jsonResponse(payloads.get(new URL(url).hostname));
    },
  });

  assert.equal(requested.length, 4);
  assert.deepEqual(
    streams.map((stream) => [stream.name, stream.url ?? stream.infoHash]),
    [
      ["Latino · 4K", "https://play.example/progreso-4k"],
      ["Latino · 1080p", "https://play.example/progreso-1080"],
      ["Castellano · 4K", "peerflix-castellano"],
      ["Español · 4K", "https://play.example/cometa-multi"],
      ["Inglés · 4K", "https://play.example/cometa-multi"],
    ],
  );
  assert.deepEqual(streams[0].behaviorHints, {
    filename: "toy-story-5-2160p.mkv",
  });
  assert.equal("description" in streams[0], false);
  assert.equal(streams[2].fileIdx, 3);
  assert.equal(streams[3].url, streams[4].url);
});

test("keeps successful providers when another upstream fails", async () => {
  const errors = [];
  const streams = await aggregateStreams(
    {
      providers: [
        {
          id: "progresoLatino",
          manifestUrl: "https://broken.example/manifest.json",
        },
        {
          id: "peerflix",
          manifestUrl: "https://working.example/manifest.json",
        },
      ],
    },
    "movie",
    "tt123",
    {
      fetchImpl: async (url) => {
        if (new URL(url).hostname === "broken.example") {
          return jsonResponse({ error: true }, 502);
        }
        return jsonResponse({
          streams: [
            {
              name: "Peerflix 1080p",
              description: "Castellano",
              url: "https://play.example/working",
            },
          ],
        });
      },
      onProviderError: (provider, error) =>
        errors.push([provider, error.message]),
    },
  );

  assert.equal(streams.length, 1);
  assert.equal(streams[0].name, "Castellano · 1080p");
  assert.deepEqual(errors, [["progresoLatino", "HTTP 502"]]);
});

test("response cache expires entries", (context) => {
  context.mock.timers.enable({ apis: ["Date"], now: 1_000 });
  const cache = new ResponseCache(500);
  cache.set("key", ["value"]);
  assert.deepEqual(cache.get("key"), ["value"]);

  context.mock.timers.tick(501);
  assert.equal(cache.get("key"), null);
});
