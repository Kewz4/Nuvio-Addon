import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { PROVIDERS } from "./providers.js";

const TOKEN_VERSION = "v1";
const MINIMUM_SECRET_LENGTH = 16;

function isTruthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "").trim().toLocaleLowerCase("en"),
  );
}

export function allowPrivateUpstreamsFromEnv(env = process.env) {
  return isTruthy(env.ALLOW_PRIVATE_UPSTREAMS);
}

function isPrivateIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => Number.isNaN(value))) {
    return false;
  }

  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a === 0
  );
}

function isPrivateHostname(hostname) {
  const normalized = hostname
    .toLocaleLowerCase("en")
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  ) {
    return true;
  }

  const ipType = net.isIP(normalized);
  if (ipType === 4) {
    return isPrivateIpv4(normalized);
  }
  if (ipType === 6) {
    if (normalized.startsWith("::ffff:")) {
      const mapped = normalized.slice("::ffff:".length);
      if (net.isIP(mapped) === 4) {
        return isPrivateIpv4(mapped);
      }
      const words = mapped.split(":");
      if (words.length === 2) {
        const high = Number.parseInt(words[0], 16);
        const low = Number.parseInt(words[1], 16);
        if (Number.isFinite(high) && Number.isFinite(low)) {
          const address = [
            high >> 8,
            high & 0xff,
            low >> 8,
            low & 0xff,
          ].join(".");
          return isPrivateIpv4(address);
        }
      }
    }

    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff")
    );
  }

  return false;
}

export async function assertPublicManifestHost(
  manifestUrl,
  lookup = dns.lookup,
) {
  const url = new URL(manifestUrl);
  const addresses = await lookup(url.hostname.replace(/^\[|\]$/g, ""), {
    all: true,
    verbatim: true,
  });

  if (
    !Array.isArray(addresses) ||
    addresses.length === 0 ||
    addresses.some((entry) => isPrivateHostname(entry?.address ?? ""))
  ) {
    throw new Error("The upstream hostname resolves to a private address.");
  }
}

export function validateManifestUrl(value, { allowPrivate = false } = {}) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("The manifest URL is empty.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("The manifest URL is not a valid URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Manifest URLs must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Manifest URLs cannot contain URL credentials.");
  }
  if (!allowPrivate && isPrivateHostname(url.hostname)) {
    throw new Error("Private and local upstream addresses are disabled.");
  }
  if (!url.pathname.endsWith("/manifest.json")) {
    throw new Error("The URL must end in /manifest.json.");
  }

  url.hash = "";
  return url.toString();
}

export function normalizeConfig(input, options = {}) {
  const allowPrivate = options.allowPrivate ?? false;
  const source = input && typeof input === "object" ? input : {};
  const providers = [];

  for (const provider of PROVIDERS) {
    const rawValue =
      source[provider.id] ??
      source.providers?.find?.((item) => item?.id === provider.id)?.manifestUrl;
    if (typeof rawValue !== "string" || !rawValue.trim()) {
      continue;
    }

    providers.push({
      id: provider.id,
      manifestUrl: validateManifestUrl(rawValue, { allowPrivate }),
    });
  }

  if (providers.length === 0) {
    throw new Error("Add at least one upstream manifest URL.");
  }

  return { providers };
}

export function loadEnvironmentConfig(
  env = process.env,
  { allowPrivate = allowPrivateUpstreamsFromEnv(env) } = {},
) {
  const input = Object.fromEntries(
    PROVIDERS.map((provider) => [
      provider.id,
      String(env[provider.envName] ?? "").trim(),
    ]),
  );

  if (Object.values(input).every((value) => !value)) {
    return null;
  }

  return normalizeConfig(input, { allowPrivate });
}

function deriveKey(secret) {
  if (typeof secret !== "string" || secret.length < MINIMUM_SECRET_LENGTH) {
    throw new Error(
      `CONFIG_SECRET must contain at least ${MINIMUM_SECRET_LENGTH} characters.`,
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptConfig(config, secret) {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(config), "utf8");
  const ciphertext = Buffer.concat([
    cipher.update(plaintext),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [
    TOKEN_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function decryptConfig(
  token,
  secret,
  { allowPrivate = false } = {},
) {
  const key = deriveKey(secret);
  const [version, ivValue, ciphertextValue, tagValue, ...extra] =
    String(token).split(".");

  if (
    version !== TOKEN_VERSION ||
    !ivValue ||
    !ciphertextValue ||
    !tagValue ||
    extra.length
  ) {
    throw new Error("The configuration link is invalid.");
  }

  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");

    return normalizeConfig(JSON.parse(plaintext), { allowPrivate });
  } catch {
    throw new Error(
      "The configuration link is invalid or belongs to another deployment.",
    );
  }
}
