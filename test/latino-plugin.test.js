import test from "node:test";
import assert from "node:assert/strict";
import {
  adaptPluginStream,
  fetchLatinoPluginStreams,
  parsePluginRequest,
} from "../src/latino-plugin.js";

test("parses TMDB and IMDb movie and episode identifiers", () => {
  assert.deepEqual(parsePluginRequest("movie", "tmdb:550"), {
    mediaType: "movie",
    tmdbId: "550",
    imdbId: null,
    season: null,
    episode: null,
  });
  assert.deepEqual(parsePluginRequest("series", "tt0903747:2:3"), {
    mediaType: "tv",
    tmdbId: null,
    imdbId: "tt0903747",
    season: 2,
    episode: 3,
  });
});

test("converts plugin request headers to Nuvio playback hints", () => {
  assert.deepEqual(
    adaptPluginStream(
      {
        name: "SeriesMetro",
        title: "720p · Latino · Fastream",
        quality: "720p",
        url: "https://video.example/episode.m3u8",
        headers: {
          Referer: "https://fastream.to/",
          "User-Agent": "Nuvio test",
        },
      },
      "seriesmetro",
    ),
    {
      name: "SeriesMetro",
      title: "720p · Latino · Fastream · 720p",
      url: "https://video.example/episode.m3u8",
      behaviorHints: {
        proxyHeaders: {
          request: {
            Referer: "https://fastream.to/",
            "User-Agent": "Nuvio test",
          },
        },
      },
    },
  );
});

test("bridges eligible plugin scrapers using a resolved TMDB id", async () => {
  const calls = [];
  const streams = await fetchLatinoPluginStreams(
    "series",
    "tt0903747:1:2",
    {
      fetchImpl: async (url) => {
        assert.match(String(url), /\/find\/tt0903747\?/);
        return new Response(
          JSON.stringify({
            movie_results: [],
            tv_results: [{ id: 1396 }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      scrapers: [
        {
          id: "movie-only",
          supportedTypes: ["movie"],
          getStreams() {
            throw new Error("Movie scraper should not run for a series.");
          },
        },
        {
          id: "seriesmetro",
          supportedTypes: ["tv"],
          async getStreams(...args) {
            calls.push(args);
            return [
              {
                title: "1080p · Latino",
                url: "https://video.example/series",
              },
            ];
          },
        },
      ],
    },
  );

  assert.deepEqual(calls, [["1396", "tv", 1, 2]]);
  assert.equal(streams.length, 1);
  assert.equal(streams[0].url, "https://video.example/series");
});
