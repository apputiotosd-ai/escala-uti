// Instalacao na tela de inicio.
// O Chrome avisa quando pode instalar, e esse aviso costuma chegar antes
// de a tela de login existir. Por isso o evento e capturado aqui, uma vez so.

let deferred = null;
const listeners = new Set();

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e;
  listeners.forEach((fn) => fn());
});

window.addEventListener("appinstalled", () => {
  deferred = null;
  listeners.forEach((fn) => fn());
});

export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

export const isAndroid = () => /Android/.test(navigator.userAgent);

export const isIOS = () => {
  const ua = navigator.userAgent;
  // Android vem primeiro: o teste de iPad abaixo confunde aparelho Android
  // emulado a partir de um Mac.
  if (isAndroid()) return false;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPad recente se apresenta como Mac, mas tem toque
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
};

export const canPrompt = () => deferred !== null;

export async function promptInstall() {
  if (!deferred) return false;
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  if (outcome === "accepted") deferred = null;
  return outcome === "accepted";
}

export function onInstallChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
