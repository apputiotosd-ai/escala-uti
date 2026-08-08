// Inscricao do aparelho para receber aviso mesmo com o app fechado.
// No iPhone so funciona depois de instalar na tela de inicio, e a permissao
// precisa ser pedida a partir de um toque da pessoa.
import { sb, S } from "../store.js";
import { VAPID_PUBLIC_KEY } from "../config.js";

const b64ToBytes = (s) => {
  const p = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
const bytesToB64 = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export const suportaPush = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** No iPhone o push exige app instalado na tela de inicio. */
export const precisaInstalar = () => {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) ||
              (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const instalado = window.matchMedia("(display-mode: standalone)").matches ||
                    window.navigator.standalone === true;
  return iOS && !instalado;
};

export const permissao = () => (suportaPush() ? Notification.permission : "unsupported");

export async function inscricaoAtual() {
  if (!suportaPush()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
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

  const reg = await navigator.serviceWorker.ready;
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
