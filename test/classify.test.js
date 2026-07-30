import test from "node:test";
import assert from "node:assert/strict";
import { classifyStream, isPlayableStream } from "../src/classify.js";
import { PROVIDER_BY_ID } from "../src/providers.js";

test("classifies a Progreso Latino card from its simple title", () => {
  const result = classifyStream(
    {
      name: "4K",
      description: "Toy Story 5\n24.7 Mbps\nLatino",
      url: "https://video.example/movie.m3u8",
    },
    PROVIDER_BY_ID.get("progresoLatino"),
  );

  assert.deepEqual(result, {
    resolution: "4K",
    resolutionRank: 1,
    languages: ["Latino"],
  });
});

test("keeps Castellano and English as one audio combination", () => {
  const result = classifyStream(
    {
      name: "[TB+] Peerflix es 4K",
      description:
        "Vengadores Endgame [4K UHD 2160p][Castellano DTS-HD 7.1-Ingles Atmos]",
      infoHash: "abc",
    },
    PROVIDER_BY_ID.get("peerflix"),
  );

  assert.deepEqual(result.languages, ["Castellano", "Inglés"]);
  assert.equal(result.resolution, "4K");
});

test("reads Cometa flag codes without matching letters inside words", () => {
  const result = classifyStream(
    {
      name: "[TB ⚡] Comet 1080p",
      description: "Vengadores.Endgame.mkv\n🌎/GB/ES",
      url: "https://video.example/comet",
    },
    PROVIDER_BY_ID.get("cometa"),
  );

  assert.deepEqual(result.languages, ["Español", "Inglés"]);
  assert.equal(result.resolution, "1080p");
});

test("uses parsed MediaFusion languages when they are available", () => {
  const result = classifyStream(
    {
      name: "MediaFusion | ElfHosted 2160p",
      clientResolve: {
        stream: {
          raw: {
            parsed: {
              resolution: "2160p",
              languages: ["en", "es"],
            },
          },
        },
      },
      url: "https://video.example/mediafusion",
    },
    PROVIDER_BY_ID.get("mediafusion"),
  );

  assert.deepEqual(result.languages, ["Español", "Inglés"]);
  assert.equal(result.resolution, "4K");
});

test("drops a stream when its language or resolution cannot be established", () => {
  assert.equal(
    classifyStream(
      { name: "Mystery release", url: "https://video.example/unknown" },
      PROVIDER_BY_ID.get("mediafusion"),
    ),
    null,
  );
});

test("accepts direct, torrent, and client-resolved streams", () => {
  assert.equal(isPlayableStream({ url: "https://example.com/video" }), true);
  assert.equal(isPlayableStream({ infoHash: "abc" }), true);
  assert.equal(isPlayableStream({ clientResolve: { type: "debrid" } }), true);
  assert.equal(isPlayableStream({ name: "not playable" }), false);
  assert.equal(isPlayableStream(null), false);
});
