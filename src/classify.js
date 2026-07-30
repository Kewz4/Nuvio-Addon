const LANGUAGE_ORDER = new Map([
  ["Latino", 0],
  ["Castellano", 1],
  ["Español", 2],
  ["Inglés", 3],
  ["Portugués", 4],
  ["Francés", 5],
  ["Italiano", 6],
  ["Alemán", 7],
  ["Japonés", 8],
  ["Coreano", 9],
  ["Ruso", 10],
  ["Multidioma", 99],
]);

const RESOLUTIONS = [
  { label: "8K", rank: 0, patterns: [/\b4320p\b/i, /\b8k\b/i] },
  { label: "4K", rank: 1, patterns: [/\b2160p\b/i, /\b4k\b/i, /\buhd\b/i] },
  { label: "1440p", rank: 2, patterns: [/\b1440p\b/i, /\bqhd\b/i] },
  { label: "1080p", rank: 3, patterns: [/\b1080[pi]\b/i, /\bfhd\b/i] },
  { label: "720p", rank: 4, patterns: [/\b720[pi]\b/i] },
  { label: "576p", rank: 5, patterns: [/\b576[pi]\b/i] },
  { label: "480p", rank: 6, patterns: [/\b480[pi]\b/i, /\bsd\b/i] },
  { label: "360p", rank: 7, patterns: [/\b360[pi]\b/i] },
];

const LANGUAGE_RULES = [
  {
    label: "Latino",
    codes: ["es-419", "es_mx", "spa-lat", "lat"],
    patterns: [
      /\blatino(?:america)?\b/i,
      /\blatam\b/i,
      /\bes[-_ ]?419\b/i,
      /\bspanish[ ._-]?latino\b/i,
      /🇲🇽|🇬🇹|🇨🇴|🇦🇷/,
    ],
  },
  {
    label: "Castellano",
    codes: ["es-es", "castilian"],
    patterns: [
      /\bcastellano\b/i,
      /\bcastilian\b/i,
      /\bes[-_ ]?es\b/i,
      /🇪🇸/,
    ],
  },
  {
    label: "Español",
    codes: ["es", "spa", "spanish", "espanol", "español"],
    patterns: [/\bespañol\b/i, /\bespanol\b/i, /\bspanish\b/i],
  },
  {
    label: "Inglés",
    codes: ["en", "eng", "english", "gb", "uk"],
    patterns: [/\benglish\b/i, /\bingl[eé]s\b/i, /🇬🇧|🇺🇸/],
  },
  {
    label: "Portugués",
    codes: ["pt", "por", "portuguese", "pt-br", "pt-pt"],
    patterns: [/\bportugu[eê]s\b/i, /\bportuguese\b/i, /🇵🇹|🇧🇷/],
  },
  {
    label: "Francés",
    codes: ["fr", "fra", "fre", "french"],
    patterns: [/\bfran[cç]ais\b/i, /\bfrench\b/i, /🇫🇷/],
  },
  {
    label: "Italiano",
    codes: ["it", "ita", "italian"],
    patterns: [/\bitaliano?\b/i, /\bitalian\b/i, /🇮🇹/],
  },
  {
    label: "Alemán",
    codes: ["de", "deu", "ger", "german"],
    patterns: [/\balem[aá]n\b/i, /\bgerman\b/i, /🇩🇪/],
  },
  {
    label: "Japonés",
    codes: ["ja", "jpn", "japanese"],
    patterns: [/\bjapon[eé]s\b/i, /\bjapanese\b/i, /🇯🇵/],
  },
  {
    label: "Coreano",
    codes: ["ko", "kor", "korean"],
    patterns: [/\bcoreano\b/i, /\bkorean\b/i, /🇰🇷/],
  },
  {
    label: "Ruso",
    codes: ["ru", "rus", "russian"],
    patterns: [/\bruso\b/i, /\brussian\b/i, /🇷🇺/],
  },
];

const CODE_SEPARATOR = "(?:^|[\\s()[\\]{}._+/,|:;-])";
const CODE_END = "(?=$|[\\s()[\\]{}._+/,|:;-])";

function collectText(stream) {
  const raw = stream?.clientResolve?.stream?.raw;
  const parsed = raw?.parsed;

  return [
    stream?.name,
    stream?.title,
    stream?.description,
    stream?.behaviorHints?.filename,
    stream?.clientResolve?.filename,
    stream?.clientResolve?.torrentName,
    raw?.filename,
    raw?.torrentName,
    parsed?.raw_title,
    parsed?.rawTitle,
    parsed?.parsed_title,
    parsed?.parsedTitle,
    parsed?.resolution,
    parsed?.quality,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n");
}

function metadataLanguageValues(stream) {
  const parsed = stream?.clientResolve?.stream?.raw?.parsed;
  const values = parsed?.languages;
  return Array.isArray(values)
    ? values.filter((value) => typeof value === "string")
    : [];
}

function hasLanguageCode(text, code) {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${CODE_SEPARATOR}${escaped}${CODE_END}`, "i").test(text);
}

function findLanguages(stream, provider) {
  const text = collectText(stream);
  const metadata = metadataLanguageValues(stream);
  const found = new Set();

  for (const rule of LANGUAGE_RULES) {
    const metadataMatch = metadata.some((value) => {
      const normalized = value.trim().toLocaleLowerCase("en");
      return rule.codes.some((code) => normalized === code.toLocaleLowerCase("en"));
    });
    const textCodeMatch = rule.codes.some((code) => hasLanguageCode(text, code));
    const textPatternMatch = rule.patterns.some((pattern) => pattern.test(text));

    if (metadataMatch || textCodeMatch || textPatternMatch) {
      found.add(rule.label);
    }
  }

  if (provider?.id === "progresoLatino") {
    found.add("Latino");
  } else if (found.size === 0 && provider?.fallbackLanguage) {
    found.add(provider.fallbackLanguage);
  }

  if (found.has("Latino") || found.has("Castellano")) {
    found.delete("Español");
  }

  const hasExplicitLanguage = [...found].some(
    (language) => language !== "Multidioma",
  );
  if (!hasExplicitLanguage && /\b(?:multi|multiaudio|dual audio)\b/i.test(text)) {
    found.add("Multidioma");
  }

  return [...found].sort(
    (a, b) =>
      (LANGUAGE_ORDER.get(a) ?? 100) - (LANGUAGE_ORDER.get(b) ?? 100),
  );
}

function findResolution(stream) {
  const text = collectText(stream);

  for (const resolution of RESOLUTIONS) {
    if (resolution.patterns.some((pattern) => pattern.test(text))) {
      return { label: resolution.label, rank: resolution.rank };
    }
  }

  return null;
}

export function classifyStream(stream, provider) {
  const resolution = findResolution(stream);
  const languages = findLanguages(stream, provider);

  if (!resolution || languages.length === 0) {
    return null;
  }

  return {
    resolution: resolution.label,
    resolutionRank: resolution.rank,
    languages,
  };
}

export function languageRank(language) {
  return LANGUAGE_ORDER.get(language) ?? 100;
}

export function isPlayableStream(stream) {
  if (!stream || typeof stream !== "object" || Array.isArray(stream)) {
    return false;
  }

  return Boolean(
    stream.url ||
      stream.externalUrl ||
      stream.infoHash ||
      stream.ytId ||
      stream.clientResolve,
  );
}
