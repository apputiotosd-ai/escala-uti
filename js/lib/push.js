// Inscricao do aparelho para receber aviso mesmo com o app fechado.
// No iPhone so funciona depois de instalar na tela de inicio, e a permissao
// precisa ser pedida a partir de um toque da pessoa.
import { sb, S } from "../store.js";
import { VAPID_PUBLIC_KEY } from "../config.js";
import { isIOS, isStandalone } from "./install.js";

const b64ToBytes = (s) => {
  const p = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
const bytesToB64 = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const suportaPush = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/**
 * No iPhone o push exige o app instalado na tela de início.
 * Isto precisa ser checado ANTES de suportaPush: no Safari sem instalar, o
 * PushManager nem existe, e o app acabava dizendo "este navegador não recebe
 * aviso" para quem apenas ainda não tinha instalado.
 */
export const precisaInstalar = () => isIOS() && !isStandalone();

export const permissao = () => (suportaPush() ? Notification.permission : "unsupported");

/**
 * serviceWorker.ready fica pendurado para sempre quando nao existe service
 * worker registrado. Isso travava a tela de Perfil e o passo a passo numa
 * primeira visita em que o registro falhasse. Aqui a espera tem prazo.
 */
async function registroPronto(msLimite = 4000) {
  if (!("serviceWorker" in navigator)) return null;
  const existente = await navigator.serviceWorker.getRegistration().catch(() => null);
  if (!existente) return null;
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((r) => setTimeout(() => r(existente), msLimite)),
  ]);
}

export async function inscricaoAtual() {
  if (!suportaPush()) return null;
  const reg = await registroPronto();
  if (!reg?.pushManager) return null;
  return reg.pushManager.getSubscription().catch(() => null);
}

function nomeAparelho() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows";
  return "Navegador";
}

/** Pede permissao e registra o aparelho. Devolve o motivo quando nao da. */
export async function ativarPush() {
  if (!suportaPush()) return { ok: false, motivo: "Este navegador não recebe aviso." };
  if (precisaInstalar()) {
    return { ok: false, motivo: "No iPhone, instale o app na tela de início antes de ligar o aviso." };
  }

  const p = await Notification.requestPermission();
  if (p !== "granted") {
    return {
      ok: false,
      motivo: p === "denied"
        ? "Você bloqueou o aviso para este site. Libere nos ajustes do navegador."
        : "Permissão não concedida.",
    };
  }

  const reg = await registroPronto(8000);
  if (!reg?.pushManager) {
    return { ok: false, motivo: "O app ainda está carregando. Tente de novo em alguns segundos." };
  }
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(VAPID_PUBLIC_KEY),
    });
  }

  const chaves = sub.toJSON().keys || {};
  const { error } = await sb.rpc("registrar_push", {
    p_org: S.org.id,
    p_endpoint: sub.endpoint,
    p_p256dh: chaves.p256dh || bytesToB64(sub.getKey("p256dh")),
    p_auth: chaves.auth || bytesToB64(sub.getKey("auth")),
    p_aparelho: nomeAparelho(),
  });
  if (error) return { ok: false, motivo: error.message };
  return { ok: true };
}

export async function desativarPush() {
  const sub = await inscricaoAtual();
  if (!sub) return { ok: true };
  await sb.rpc("remover_push", { p_endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => {});
  return { ok: true };
}

/** Aparelhos que a pessoa ja ligou, para ela reconhecer e desligar. */
export async function meusAparelhos() {
  const { data, error } = await sb
    .from("push_subscriptions")
    .select("id, aparelho, criado_em, ultimo_ok")
    .order("criado_em", { ascending: false });
  if (error) return [];
  return data || [];
}
