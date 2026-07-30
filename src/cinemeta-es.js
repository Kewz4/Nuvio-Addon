const CINEMETA_BASE_URL = "https://v3-cinemeta.strem.io";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";
const DEFAULT_TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";

const GENRES = Object.freeze({
  Action: "Acción",
  Adventure: "Aventura",
  Animation: "Animación",
  Biography: "Biografía",
  Comedy: "Comedia",
  Crime: "Crimen",
  Documentary: "Documental",
  Drama: "Drama",
  Family: "Familia",
  Fantasy: "Fantasía",
  History: "Historia",
  Horror: "Terror",
  Mystery: "Misterio",
  Romance: "Romance",
  "Sci-Fi": "Ciencia ficción",
  Sport: "Deportes",
  Thriller: "Suspenso",
  War: "Bélica",
  Western: "Oeste",
  "Reality-TV": "Telerrealidad",
  "Talk-Show": "Programa de entrevistas",
  "Game-Show": "Concurso",
});

const SPANISH_TO_CINEMETA_GENRE = new Map(
  Object.entries(GENRES).map(([english, spanish]) => [spanish, english]),
);
const MOVIE_GENRES = Object.keys(GENRES).slice(0, 20);
const SERIES_GENRES = Object.keys(GENRES);

function catalog(type, id, name, genres, extra) {
  return {
    type,
    id,
    name,
    genres,
    extra,
    extraSupported: extra.map((item) => item.name),
    ...(extra.filter((item) => item.isRequired).length
      ? {
          extraRequired: extra
            .filter((item) => item.isRequired)
            .map((item) => item.name),
        }
      : {}),
  };
}

function translatedGenreOptions(genres) {
  return genres.map((genre) => GENRES[genre] ?? genre);
}

const YEARS = Array.from(
  { length: new Date().getUTCFullYear() - 1919 },
  (_, index) => String(new Date().getUTCFullYear() - index),
);

const CINEMETA_ES_CATALOGS = Object.freeze([
  catalog(
    "movie",
    "top",
    "Películas populares",
    translatedGenreOptions(MOVIE_GENRES),
    [
      { name: "genre", options: translatedGenreOptions(MOVIE_GENRES) },
      { name: "search" },
      { name: "skip" },
    ],
  ),
  catalog(
    "series",
    "top",
    "Series populares",
    translatedGenreOptions(SERIES_GENRES),
    [
      { name: "genre", options: translatedGenreOptions(SERIES_GENRES) },
      { name: "search" },
      { name: "skip" },
    ],
  ),
  catalog("movie", "year", "Películas nuevas", YEARS, [
    { name: "genre", options: YEARS, isRequired: true },
    { name: "skip" },
  ]),
  catalog("series", "year", "Series nuevas", YEARS, [
    { name: "genre", options: YEARS, isRequired: true },
    { name: "skip" },
  ]),
  catalog(
    "movie",
    "imdbRating",
    "Películas destacadas",
    translatedGenreOptions(MOVIE_GENRES),
    [
      { name: "genre", options: translatedGenreOptions(MOVIE_GENRES) },
      { name: "skip" },
    ],
  ),
  catalog(
    "series",
    "imdbRating",
    "Series destacadas",
    translatedGenreOptions(SERIES_GENRES),
    [
      { name: "genre", options: translatedGenreOptions(SERIES_GENRES) },
      { name: "skip" },
    ],
  ),
  catalog("series", "last-videos", "Últimos episodios", [], [
    { name: "lastVideosIds", isRequired: true, optionsLimit: 100 },
  ]),
  catalog("series", "calendar-videos", "Calendario", [], [
    { name: "calendarVideosIds", isRequired: true, optionsLimit: 100 },
  ]),
]);

export function spanishCinemetaManifest(baseUrl) {
  return {
    id: "community.cinemeta-es",
    version: "1.0.0",
    name: "Cinemeta en Español",
    description:
      "Catálogos y metadatos de Cinemeta traducidos al español latino.",
    logo: `${baseUrl}/icon.svg`,
    resources: [
      { name: "catalog", types: ["movie", "series"] },
      {
        name: "meta",
        types: ["movie", "series"],
        idPrefixes: ["tt"],
      },
    ],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: CINEMETA_ES_CATALOGS,
    language: "es-419",
    behaviorHints: {
      configurable: false,
      configurationRequired: false,
      newEpisodeNotifications: true,
    },
  };
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/json",
      "user-agent": "Nuvio-Cinemeta-ES/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}.`);
  }
  return response.json();
}

function tmdbImage(path, size) {
  return typeof path === "string" && path
    ? `${TMDB_IMAGE_BASE_URL}/${size}${path}`
    : null;
}

function isoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))
    ? `${value}T00:00:00.000Z`
    : null;
}

function spanishCountryNames(countries) {
  if (!Array.isArray(countries)) {
    return null;
  }

  const displayNames = new Intl.DisplayNames(["es"], { type: "region" });
  const names = countries
    .map((country) => {
      try {
        return displayNames.of(country?.iso_3166_1);
      } catch {
        return country?.name;
      }
    })
    .filter(Boolean);
  return names.length ? names.join(", ") : null;
}

function translatedStatus(value) {
  const statuses = {
    "Returning Series": "En emisión",
    Ended: "Finalizada",
    Canceled: "Cancelada",
    "In Production": "En producción",
    Planned: "Planeada",
    Pilot: "Piloto",
    Released: "Estrenada",
    "Post Production": "Posproducción",
  };
  return statuses[value] ?? value;
}

function translateLinks(links) {
  return Array.isArray(links)
    ? links.map((link) => ({
        ...link,
        name: GENRES[link?.name] ?? link?.name,
        category:
          link?.category === "Genres" ? "Géneros" : link?.category,
      }))
    : links;
}

function overlayTmdbMeta(type, meta, details) {
  if (!details || typeof details !== "object") {
    return meta;
  }

  const isMovie = type === "movie";
  const releaseDate = isMovie
    ? details.release_date
    : details.first_air_date;
  const runtime = isMovie
    ? details.runtime
    : details.episode_run_time?.[0];
  const translated = {
    ...meta,
    name: (isMovie ? details.title : details.name) || meta.name,
    description: details.overview || meta.description,
    genre:
      details.genres?.map((genre) => genre.name).filter(Boolean) ??
      meta.genre,
    genres:
      details.genres?.map((genre) => genre.name).filter(Boolean) ??
      meta.genres,
    poster: tmdbImage(details.poster_path, "w500") || meta.poster,
    background:
      tmdbImage(details.backdrop_path, "w1280") || meta.background,
    cast:
      details.credits?.cast
        ?.slice(0, 10)
        .map((person) => person.name)
        .filter(Boolean) ?? meta.cast,
    country:
      spanishCountryNames(details.production_countries) ?? meta.country,
    released: isoDate(releaseDate) ?? meta.released,
    year: String(releaseDate ?? "").slice(0, 4) || meta.year,
    releaseInfo:
      String(releaseDate ?? "").slice(0, 4) || meta.releaseInfo,
    runtime:
      Number.isFinite(runtime) && runtime > 0
        ? `${runtime} min`
        : meta.runtime,
    status: translatedStatus(details.status) ?? meta.status,
    links: translateLinks(meta.links),
  };

  if (isMovie) {
    const crew = details.credits?.crew ?? [];
    const directors = crew
      .filter((person) => person.job === "Director")
      .map((person) => person.name);
    const writers = crew
      .filter((person) =>
        ["Writer", "Screenplay", "Story"].includes(person.job),
      )
      .map((person) => person.name);
    if (directors.length) {
      translated.director = [...new Set(directors)];
    }
    if (writers.length) {
      translated.writer = [...new Set(writers)];
    }
  } else if (Array.isArray(details.created_by) && details.created_by.length) {
    translated.director = details.created_by
      .map((person) => person.name)
      .filter(Boolean);
  }

  delete translated.awards;
  delete translated.logo;
  return translated;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, items.length) },
      () => worker(),
    ),
  );
  return output;
}

async function tmdbDetails(
  type,
  tmdbId,
  { fetchImpl, tmdbApiKey, extended = false },
) {
  const tmdbType = type === "series" ? "tv" : "movie";
  const url = new URL(`${TMDB_BASE_URL}/${tmdbType}/${tmdbId}`);
  url.searchParams.set("api_key", tmdbApiKey);
  url.searchParams.set("language", "es-419");
  if (extended) {
    url.searchParams.set("append_to_response", "credits");
  }
  return fetchJson(url, fetchImpl);
}

async function translateCatalogMeta(
  type,
  meta,
  { fetchImpl, tmdbApiKey },
) {
  const tmdbId = meta?.moviedb_id;
  if (!tmdbId) {
    return meta;
  }

  try {
    const details = await tmdbDetails(type, tmdbId, {
      fetchImpl,
      tmdbApiKey,
    });
    return overlayTmdbMeta(type, meta, details);
  } catch {
    return meta;
  }
}

function upstreamExtra(extra) {
  if (!extra) {
    return "";
  }

  return String(extra)
    .split("&")
    .map((entry) => {
      const separator = entry.indexOf("=");
      const key = separator >= 0 ? entry.slice(0, separator) : entry;
      const value = separator >= 0 ? entry.slice(separator + 1) : "";
      const translatedValue =
        key === "genre"
          ? (SPANISH_TO_CINEMETA_GENRE.get(value) ?? value)
          : value;
      return `${encodeURIComponent(key)}=${encodeURIComponent(translatedValue)}`;
    })
    .join("&");
}

export async function fetchSpanishCatalog(
  type,
  catalogId,
  extra,
  {
    fetchImpl = globalThis.fetch,
    tmdbApiKey = DEFAULT_TMDB_API_KEY,
  } = {},
) {
  if (
    !["movie", "series"].includes(type) ||
    !CINEMETA_ES_CATALOGS.some(
      (item) => item.type === type && item.id === catalogId,
    )
  ) {
    return null;
  }

  const translatedExtra = upstreamExtra(extra);
  const suffix = translatedExtra ? `/${translatedExtra}` : "";
  const payload = await fetchJson(
    `${CINEMETA_BASE_URL}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}${suffix}.json`,
    fetchImpl,
  );
  const metas = Array.isArray(payload?.metas) ? payload.metas : [];

  return {
    ...payload,
    metas: await mapWithConcurrency(metas, 8, (meta) =>
      translateCatalogMeta(type, meta, { fetchImpl, tmdbApiKey }),
    ),
  };
}

async function translateSeriesEpisodes(
  meta,
  tmdbId,
  { fetchImpl, tmdbApiKey },
) {
  const videos = Array.isArray(meta?.videos) ? meta.videos : [];
  const seasons = [
    ...new Set(
      videos
        .map((video) => Number(video?.season))
        .filter((season) => Number.isInteger(season) && season >= 0),
    ),
  ];
  const translatedSeasons = await mapWithConcurrency(
    seasons,
    6,
    async (season) => {
      try {
        const url = new URL(`${TMDB_BASE_URL}/tv/${tmdbId}/season/${season}`);
        url.searchParams.set("api_key", tmdbApiKey);
        url.searchParams.set("language", "es-419");
        const payload = await fetchJson(url, fetchImpl);
        return [season, payload];
      } catch {
        return [season, null];
      }
    },
  );
  const episodeMap = new Map();

  for (const [season, payload] of translatedSeasons) {
    for (const episode of payload?.episodes ?? []) {
      episodeMap.set(`${season}:${episode.episode_number}`, episode);
    }
  }

  return videos.map((video) => {
    const translated = episodeMap.get(
      `${Number(video?.season)}:${Number(video?.number ?? video?.episode)}`,
    );
    if (!translated) {
      return video;
    }

    return {
      ...video,
      name: translated.name || video.name,
      overview: translated.overview || video.overview,
      description: translated.overview || video.description,
      thumbnail:
        tmdbImage(translated.still_path, "w780") || video.thumbnail,
    };
  });
}

export async function fetchSpanishMeta(
  type,
  id,
  {
    fetchImpl = globalThis.fetch,
    tmdbApiKey = DEFAULT_TMDB_API_KEY,
  } = {},
) {
  if (!["movie", "series"].includes(type) || !/^tt\d+$/i.test(id)) {
    return null;
  }

  const payload = await fetchJson(
    `${CINEMETA_BASE_URL}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`,
    fetchImpl,
  );
  const meta = payload?.meta;
  if (!meta || !meta.moviedb_id) {
    return payload;
  }

  try {
    const details = await tmdbDetails(type, meta.moviedb_id, {
      fetchImpl,
      tmdbApiKey,
      extended: true,
    });
    const translated = overlayTmdbMeta(type, meta, details);
    if (type === "series") {
      translated.videos = await translateSeriesEpisodes(
        translated,
        meta.moviedb_id,
        { fetchImpl, tmdbApiKey },
      );
    }
    return { ...payload, meta: translated };
  } catch {
    return payload;
  }
}
