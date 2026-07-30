# Nuvio Simple Streams

A small Stremio-compatible proxy for a deliberately simple Nuvio stream
selector. It asks the configured providers for streams, keeps one result for
each language/resolution combination, and returns short cards such as:

```text
Latino · 4K
Latino · 1080p
Castellano · 4K
Inglés · 4K
```

The playable URL, torrent hash, debrid instructions, file index, proxy headers,
and other playback fields are preserved. The visible `name`, `title`, and
`description` are simplified, and `behaviorHints.videoSize` is removed so Nuvio
does not add a `SIZE … GB` badge.

This repository includes the owner's four configured provider manifests in
`src/bundled-config.js`, plus the bundled **Latino Providers** Nuvio scraper
plugin, so `/manifest.json` is ready to install immediately.
Those URLs contain personalized credentials. Keep the repository private and
replace or remove that file before sharing a fork.

## Selection rules

Providers have a fixed priority:

1. Progreso Latino
2. Peerflix
3. Cometa
4. MediaFusion
5. Latino Providers

The first stream found for a language/resolution combination wins. A
multi-audio release can therefore produce separate cards such as
`Castellano · 4K` and `Inglés · 4K`, both pointing to the same playable release.
Results are then displayed by provider priority and resolution, so Progreso
Latino choices stay at the top. Releases without a detectable language or
resolution are omitted because they cannot produce a trustworthy simple card.

Language detection understands common names, codes, flag emoji, and
MediaFusion's parsed `clientResolve.stream.raw.parsed.languages` metadata.
Progreso Latino, Peerflix, and Cometa also have sensible Spanish fallbacks.
The Latino Providers plugin fills any remaining language/resolution gaps after
the four add-ons. Its ten scraper modules are vendored from commit
`c973db771bfc37efc0974a5486c5890eb0a73cbd` so deployments do not execute
changing remote JavaScript.

## Run locally

Requirements: Node.js 20 or newer.

```powershell
npm install
Copy-Item .env.example .env
npm start
```

Open `http://127.0.0.1:7000`. Set a permanent, random `CONFIG_SECRET` in
`.env` before generating configuration links. The secret must stay unchanged;
changing it invalidates existing links.

### Fixed personal configuration

The bundled household configuration is used automatically. To override it
without changing source, set any of these environment variables to the
provider's complete, already-configured `manifest.json` URL:

```dotenv
PROGRESO_LATINO_URL=https://.../manifest.json
PEERFLIX_URL=https://.../manifest.json
COMETA_URL=https://.../manifest.json
MEDIAFUSION_URL=https://.../manifest.json
```

The fixed add-on is available at:

```text
https://your-domain.example/manifest.json
```

This mode is the simplest option for one household.

### Spanish Cinemeta add-on

The same deployment exposes a second installable add-on:

```text
https://your-domain.example/cinemeta-es/manifest.json
```

It keeps Cinemeta's IMDb IDs, catalogs, episode structure, and discovery
filters, then overlays Latin Spanish titles, descriptions, genres, artwork,
cast, runtime, status, and episode names/descriptions from TMDB. If a Spanish
translation is unavailable, the original Cinemeta field is kept.

In Nuvio, install **Cinemeta en Español**, put it above the original Cinemeta
in the add-on order, and disable the original Cinemeta catalogs to avoid
duplicate English rows.

## Deploy

### Vercel from GitHub

Vercel is the easiest deployment option for this repository:

1. Push the repository to GitHub.
2. In Vercel, choose **Add New → Project**.
3. Import `Kewz4/Nuvio-Addon`.
4. Keep the detected defaults and deploy. Do not set a build command or output
   directory.
5. Install `https://your-project.vercel.app/manifest.json` in Nuvio.

`api/index.js` exposes the Express application as a Vercel Function, and
`vercel.json` rewrites add-on requests to it. No framework preset, build
command, output directory, or environment variables are required for the
bundled household configuration.

Use the domain shown under **Project → Settings → Domains**. A similarly named
`*.vercel.app` domain may belong to another project, and generated deployment
URLs can be protected by Vercel Authentication.

### Docker or Render

The repository also includes a `Dockerfile` and `render.yaml`. On any Docker
host:

```powershell
docker build -t nuvio-simple-streams .
docker run --rm -p 7000:7000 `
  -e CONFIG_SECRET="use-a-long-permanent-random-secret" `
  nuvio-simple-streams
```

Remote Stremio-compatible add-ons must be served over HTTPS. Put the container
behind an HTTPS reverse proxy, or deploy it to a platform that supplies HTTPS.
If the public URL seen by the app differs from the server URL, set
`PUBLIC_BASE_URL=https://your-domain.example`.

The included Render Blueprint uses a free web service. That is convenient for
testing, but free instances can sleep and delay the first stream request. Use an
always-on instance for a living-room setup where startup delay matters.

Private/loopback upstream URLs and hostnames that resolve to private addresses
are rejected by default to limit server-side request forgery. A private
self-hosted setup can opt in with `ALLOW_PRIVATE_UPSTREAMS=true`.

## Install in Nuvio

1. Copy the generated HTTPS `manifest.json` URL.
2. Add it in Nuvio's add-on settings.
3. Disable or uninstall the original Progreso Latino, Peerflix, Cometa, and
   MediaFusion add-ons, plus the separately installed Latino Providers plugin,
   on the profile your mom uses.
4. Set Nuvio's preferred audio language to Spanish/Latin Spanish when using
   multi-audio releases.

Disabling the originals matters: Nuvio creates provider filter chips from all
installed add-ons. A Stremio add-on cannot alter that client UI. With only this
aggregator enabled, the four original provider tabs disappear and all choices
are combined. Current Nuvio versions may still show the built-in **All** chip
plus one **Selección simple** chip for this aggregator; the protocol offers no
way for an add-on to suppress its own chip.

Also note that a stream can advertise multiple audio tracks, but an add-on
cannot force Nuvio to select a particular track after playback begins. Nuvio's
preferred-audio setting controls that behavior.

## Privacy

Web-generated configurations use AES-256-GCM encryption. The manifest URLs
(which can contain provider tokens) are encrypted into the generated path and
are not stored in a database. Keep `CONFIG_SECRET` private and use HTTPS.

## Verify

```powershell
npm test
npm run check
```
