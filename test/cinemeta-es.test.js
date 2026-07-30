import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchSpanishCatalog,
  fetchSpanishMeta,
  spanishCinemetaManifest,
} from "../src/cinemeta-es.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("declares Spanish Cinemeta catalogs and metadata resources", () => {
  const manifest = spanishCinemetaManifest("https://simple.example");

  assert.equal(manifest.name, "Cinemeta en Español");
  assert.equal(manifest.language, "es-419");
  assert.equal(manifest.logo, "https://simple.example/icon.svg");
  assert.ok(
    manifest.catalogs.some(
      (catalog) =>
        catalog.type === "movie" &&
        catalog.id === "top" &&
        catalog.name === "Películas populares",
    ),
  );
  assert.ok(
    manifest.resources.some((resource) => resource.name === "meta"),
  );
});

test("overlays Cinemeta movie metadata with Latin Spanish TMDB data", async () => {
  const requested = [];
  const payload = await fetchSpanishMeta("movie", "tt0133093", {
    fetchImpl: async (url) => {
      requested.push(String(url));
      if (String(url).includes("v3-cinemeta")) {
        return jsonResponse({
          meta: {
            id: "tt0133093",
            type: "movie",
            moviedb_id: 603,
            name: "The Matrix",
            description: "English overview",
            genre: ["Action", "Sci-Fi"],
            genres: ["Action", "Sci-Fi"],
            awards: "Won awards",
            logo: "https://images.example/english-logo.png",
          },
        });
      }

      return jsonResponse({
        id: 603,
        title: "Matrix",
        overview: "Una descripción en español.",
        release_date: "1999-03-31",
        runtime: 136,
        status: "Released",
        poster_path: "/poster.jpg",
        backdrop_path: "/backdrop.jpg",
        images: {
          logos: [
            {
              iso_639_1: "en",
              file_path: "/english-logo.png",
              vote_average: 10,
            },
            {
              iso_639_1: "es",
              file_path: "/spanish-logo.png",
              vote_average: 5,
            },
          ],
        },
        genres: [
          { id: 28, name: "Acción" },
          { id: 878, name: "Ciencia ficción" },
        ],
        production_countries: [{ iso_3166_1: "US", name: "United States" }],
        credits: {
          cast: [{ name: "Keanu Reeves" }],
          crew: [
            { name: "Lana Wachowski", job: "Director" },
            { name: "Lilly Wachowski", job: "Writer" },
          ],
        },
      });
    },
  });

  assert.equal(payload.meta.name, "Matrix");
  assert.equal(payload.meta.description, "Una descripción en español.");
  assert.deepEqual(payload.meta.genres, ["Acción", "Ciencia ficción"]);
  assert.equal(payload.meta.runtime, "136 min");
  assert.equal("awards" in payload.meta, false);
  assert.equal(
    payload.meta.logo,
    "https://image.tmdb.org/t/p/w500/spanish-logo.png",
  );
  assert.match(requested[1], /language=es-419/);
  assert.match(requested[1], /append_to_response=credits%2Cimages/);
  assert.match(requested[1], /include_image_language=es%2Cnull%2Cen/);
});

test("translates Cinemeta series episodes by season and episode number", async () => {
  const payload = await fetchSpanishMeta("series", "tt0903747", {
    fetchImpl: async (url) => {
      const value = String(url);
      if (value.includes("v3-cinemeta")) {
        return jsonResponse({
          meta: {
            id: "tt0903747",
            type: "series",
            moviedb_id: 1396,
            name: "Breaking Bad",
            description: "English overview",
            videos: [
              {
                id: "tt0903747:1:1",
                season: 1,
                number: 1,
                name: "Pilot",
                overview: "English episode overview",
                description: "English episode overview",
              },
            ],
          },
        });
      }
      if (value.includes("/season/1")) {
        return jsonResponse({
          episodes: [
            {
              season_number: 1,
              episode_number: 1,
              name: "Piloto",
              overview: "Resumen del episodio.",
              still_path: "/episode.jpg",
            },
          ],
        });
      }

      return jsonResponse({
        id: 1396,
        name: "Breaking Bad",
        overview: "Resumen de la serie.",
        genres: [{ id: 18, name: "Drama" }],
        production_countries: [],
        credits: { cast: [], crew: [] },
      });
    },
  });

  assert.equal(payload.meta.description, "Resumen de la serie.");
  assert.equal(payload.meta.videos[0].name, "Piloto");
  assert.equal(payload.meta.videos[0].description, "Resumen del episodio.");
  assert.match(payload.meta.videos[0].thumbnail, /\/w780\/episode\.jpg$/);
});

test("translates catalog cards and maps Spanish genre filters upstream", async () => {
  const requested = [];
  const payload = await fetchSpanishCatalog(
    "movie",
    "top",
    "genre=Acción&skip=0",
    {
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url).includes("v3-cinemeta")) {
          return jsonResponse({
            metas: [
              {
                id: "tt0133093",
                type: "movie",
                moviedb_id: 603,
                name: "The Matrix",
                description: "English overview",
                videos: [{ id: "tt0133093:1:1" }],
                trailers: [{ source: "english-trailer" }],
                trailerStreams: [{ ytId: "english-trailer" }],
                links: [{ name: "Action", category: "Genres" }],
              },
            ],
          });
        }

        return jsonResponse({
          id: 603,
          title: "Matrix",
          overview: "Descripción del catálogo.",
          images: {
            logos: [
              {
                iso_639_1: "es",
                file_path: "/catalog-logo.png",
                vote_average: 8,
              },
            ],
          },
          genres: [{ id: 28, name: "Acción" }],
          production_countries: [],
        });
      },
    },
  );

  assert.match(requested[0], /genre=Action&skip=0\.json$/);
  assert.equal(payload.metas[0].name, "Matrix");
  assert.equal(payload.metas[0].description, "Descripción del catálogo.");
  assert.equal(
    payload.metas[0].logo,
    "https://image.tmdb.org/t/p/w500/catalog-logo.png",
  );
  assert.equal("videos" in payload.metas[0], false);
  assert.equal("trailers" in payload.metas[0], false);
  assert.equal("trailerStreams" in payload.metas[0], false);
  assert.equal("links" in payload.metas[0], false);
});
