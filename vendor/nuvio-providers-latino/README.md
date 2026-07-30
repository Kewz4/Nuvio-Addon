# Nuvio-Providers-Latino

Addon de providers de contenido en español para **Nuvio Media Hub**. Proporciona streams de películas y series desde fuentes latinoamericanas y españolas, con soporte completo para FireTV (Hermes JS engine).

---

## Providers incluidos

| Provider | Películas | Series |
|---|---|---|
| `lamovie` | ✅ | ✅ |
| `cinecalidad` | ✅ | ❌ |
| `embed69` | ✅ | ✅ |
| `zoowomaniacos` | ✅ | ❌ |
| `xupalace` | ✅ | ✅ |
| `seriesmetro` | ✅ | ✅ |
| `peliserieshoy` | ✅ | ✅ |
| `detodopeliculas` | ✅ | ✅ |
| `hackstore` | ✅ | ✅ |
| `seriesflix` | ❌ | ✅ |

---

## Resolvers soportados

- **VOE** (`voe.sx`)
- **GoodStream** (`goodstream.one`)
- **Vimeos** (`vimeos.net`)
- **HLSWish / StreamWish** (`hlswish.com`, `streamwish.com`, `streamwish.to`, `strwish.com`)
- **VidHide** (`vidhide.com`)
- **Fastream** (`fastream.to`)
- **Nupload** (`nupload.me`)
- **OkRu** (`ok.ru`)
- **GDTvid** (`gdtvid.p2pplay.pro`)

---

## Testing

```bash
node --dns-result-order=ipv4first test.js [tmdbId] [tipo] [temporada] [episodio] [provider]
```

### Ejemplos

```bash
# Película
node --dns-result-order=ipv4first test.js 550 movie null null lamovie

# Serie con temporada y episodio
node --dns-result-order=ipv4first test.js 1402 tv 3 5 seriesmetro

# Provider por defecto (lamovie)
node --dns-result-order=ipv4first test.js 157336 movie
```

> El flag `--dns-result-order=ipv4first` es necesario para evitar problemas de resolución DNS en Windows.

---

## Compatibilidad con Nuvio / FireTV

Todos los providers están diseñados para funcionar con el engine **Hermes** de React Native usado en FireTV. Las restricciones aplicadas:

- Sin `axios` — todo usa `fetch` nativo
- Sin `AbortController` ni timeouts por signal
- Sin `Buffer` de Node.js — se usa `atob`/`btoa` nativo
- Sin `require()` dinámico — imports estáticos en todos los resolvers
- Build en formato CJS con target `es2016` vía esbuild
- `XMLHttpRequest` como fallback para requests que causan OOM en Hermes (gdtvid, nupload)
