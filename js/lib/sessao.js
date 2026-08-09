// Manter o médico logado, mesmo abrindo o app de vez em quando.
//
// No servidor a sessão não tem prazo. O que derruba alguém, na prática, é o
// aparelho: o Safari apaga o armazenamento de sites pouco usados, e uma
// renovação que falha por falta de sinal pode ser confundida com sessão
// vencida. Este arquivo cuida dos dois.

import { sb } from "../store.js";

/**
 * Pede ao navegador para não apagar o armazenamento deste app.
 * No iPhone, sem isto, o Safari pode limpar os dados depois de dias sem
 * uso, e o médico volta para a tela de login sem ter feito nada errado.
 * App instalado na tela de início costuma receber a permissão direto.
 */
export async function guardarSessaoNoAparelho() {
  try {
    if (!navigator.storage?.persist) return { suportado: false };
    if (await navigator.storage.persisted()) return { suportado: true, ja: true };
    const ok = await navigator.storage.persist();
    return { suportado: true, concedido: ok };
  } catch {
    return { suportado: false };
  }
}

/** Sem sinal: não é sessão vencida, é rede. */
export const semRede = (e) => {
  const m = (e?.message || "") + " " + (e?.name || "");
  return !navigator.onLine ||
    /failed to fetch|networkerror|load failed|timeout|aborted/i.test(m);
};

/**
 * Renova a sessão sem derrubar ninguém à toa.
 * Devolve 'ok', 'sem-rede' ou 'invalida'. Só 'invalida' significa que o
 * médico precisa entrar de novo.
 */
export async function renovarSessao() {
  try {
    const { data, error } = await sb.auth.getSession();
    if (error) return semRede(error) ? "sem-rede" : "invalida";
    if (!data.session) return "invalida";

    // ainda vale por bastante tempo: não gasta rede à toa
    const faltam = (data.session.expires_at || 0) * 1000 - Date.now();
    if (faltam > 24 * 3600 * 1000) return "ok";

    const { error: e2 } = await sb.auth.refreshSession();
    if (!e2) return "ok";
    return semRede(e2) ? "sem-rede" : "invalida";
  } catch (e) {
    return semRede(e) ? "sem-rede" : "invalida";
  }
}

/**
 * Renova quando o app volta para a frente. Um app na tela de início fica
 * dias suspenso; sem isto a primeira ação depois de voltar falharia.
 */
export function renovarAoVoltar(aoFalhar) {
  let ultima = 0;
  const tentar = async () => {
    if (document.visibilityState !== "visible") return;
    if (Date.now() - ultima < 60000) return;      // no máximo uma vez por minuto
    ultima = Date.now();
    const r = await renovarSessao();
    if (r === "invalida") aoFalhar?.();
  };
  document.addEventListener("visibilitychange", tentar);
  addEventListener("online", tentar);
  addEventListener("focus", tentar);
}
