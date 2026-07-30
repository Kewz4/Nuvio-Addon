export const PROVIDERS = Object.freeze([
  {
    id: "progresoLatino",
    name: "Progreso Latino",
    envName: "PROGRESO_LATINO_URL",
    fallbackLanguage: "Latino",
  },
  {
    id: "peerflix",
    name: "Peerflix",
    envName: "PEERFLIX_URL",
    fallbackLanguage: "Castellano",
  },
  {
    id: "cometa",
    name: "Cometa",
    envName: "COMETA_URL",
    fallbackLanguage: "Español",
  },
  {
    id: "mediafusion",
    name: "MediaFusion",
    envName: "MEDIAFUSION_URL",
    fallbackLanguage: null,
  },
]);

export const PROVIDER_BY_ID = new Map(
  PROVIDERS.map((provider, index) => [
    provider.id,
    Object.freeze({ ...provider, priority: index }),
  ]),
);
