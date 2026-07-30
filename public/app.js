const form = document.querySelector("#config-form");
const createButton = document.querySelector("#create-button");
const notice = document.querySelector("#notice");
const result = document.querySelector("#result");
const manifestOutput = document.querySelector("#manifest-url");
const copyButton = document.querySelector("#copy-button");
const stremioButton = document.querySelector("#stremio-button");

let currentManifestUrl = "";

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("error", isError);
  notice.hidden = !message;
}

async function loadStatus() {
  try {
    const response = await fetch("/api/status");
    const status = await response.json();

    if (status.fixedAddonReady) {
      form.hidden = true;
      currentManifestUrl = status.fixedManifestUrl;
      manifestOutput.textContent = status.fixedManifestUrl;
      manifestOutput.title = status.fixedManifestUrl;
      stremioButton.href = status.fixedManifestUrl.replace(
        /^https?:\/\//i,
        "stremio://",
      );
      result.hidden = false;
      return;
    }

    if (!status.configurationEnabled) {
      form.hidden = true;
      showNotice(
        "El administrador debe añadir CONFIG_SECRET antes de crear enlaces privados.",
      );
    }
  } catch {
    showNotice("No se pudo comprobar la configuración del servidor.", true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showNotice("");
  result.hidden = true;
  createButton.disabled = true;

  const values = Object.fromEntries(new FormData(form).entries());

  try {
    const response = await fetch("/api/configure", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(values),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "No se pudo crear el enlace.");
    }

    currentManifestUrl = payload.manifestUrl;
    manifestOutput.textContent = payload.manifestUrl;
    manifestOutput.title = payload.manifestUrl;
    stremioButton.href = payload.stremioUrl;
    result.hidden = false;
    result.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    createButton.disabled = false;
  }
});

copyButton.addEventListener("click", async () => {
  if (!currentManifestUrl) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentManifestUrl);
    copyButton.textContent = "Copiado";
    window.setTimeout(() => {
      copyButton.textContent = "Copiar enlace";
    }, 1600);
  } catch {
    showNotice("No se pudo copiar. Selecciona el enlace manualmente.", true);
  }
});

loadStatus();
