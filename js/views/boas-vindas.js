import { h, modal, toast } from "../lib/dom.js";
import { icon } from "../lib/icons.js";

const VISTO = "escala-uti-boas-vindas";

/**
 * Passo a passo mostrado na primeira entrada de cada aparelho.
 * Duas coisas dependem de o médico agir, e nenhuma delas é óbvia:
 * instalar na tela de início e liberar o aviso. O resto do app funciona
 * sozinho, então o texto não tenta ensinar tudo.
 */
export function jaViuBoasVindas() {
  try { return localStorage.getItem(VISTO) === "1"; } catch { return true; }
}

function marcarVisto() {
  try { localStorage.setItem(VISTO, "1"); } catch { /* modo privativo */ }
}

export async function abrirBoasVindas({ forcado = false } = {}) {
  const {
    suportaPush, precisaInstalar, permissao, inscricaoAtual, ativarPush,
  } = await import("../lib/push.js");
  const { isStandalone, isIOS, isAndroid, canPrompt, promptInstall } =
    await import("../lib/install.js");

  const instalado = isStandalone();
  const jaInscrito = suportaPush() ? await inscricaoAtual() : null;

  // nada a pedir e não foi chamado de propósito: não incomoda
  if (!forcado && instalado && jaInscrito) { marcarVisto(); return; }

  const estado = h("div");

  const passoInstalar = () => {
    if (instalado) return passoPronto("O app já está instalado neste aparelho.");
    if (canPrompt()) {
      return passo(1, "Instalar na tela de início",
        "Assim a escala abre como aplicativo, sem passar pelo navegador.",
        h("button", {
          class: "btn btn-primary btn-sm",
          onclick: async (e) => {
            e.target.disabled = true;
            const ok = await promptInstall();
            toast(ok ? "Instalado. Abra pelo ícone da próxima vez." : "Instalação cancelada.");
            e.target.disabled = false;
          },
        }, icon("install"), "Instalar agora"));
    }
    if (isIOS()) {
      return passo(1, "Instalar na tela de início",
        h("span", null,
          "No iPhone: toque em ", marca("share"), " na barra de baixo do Safari, ",
          "deslize a lista e escolha ", h("b", null, "Adicionar à Tela de Início"), "."));
    }
    if (isAndroid()) {
      return passo(1, "Instalar na tela de início",
        h("span", null,
          "Toque em ", marca("dots"), " no canto do navegador e escolha ",
          h("b", null, "Instalar aplicativo"), "."));
    }
    return passo(1, "Instalar na tela de início",
      "Abra este endereço no celular para instalar. No computador, o navegador " +
      "oferece a instalação pelo ícone na barra de endereço.");
  };

  const passoAviso = () => {
    if (jaInscrito) return passoPronto("O aviso já está ligado neste aparelho.");
    // no Safari sem instalar o recurso nem existe: a resposta certa é
    // "faça o passo 1 primeiro", e não "seu navegador não serve"
    if (precisaInstalar()) {
      return passo(2, "Liberar o aviso",
        h("span", null,
          "Este passo aparece depois do passo 1. Assim que a escala estiver na tela ",
          "de início, abra pelo ", h("b", null, "ícone novo"), " e ligue o aviso em ",
          h("b", null, "Perfil"), ". No Safari ele ainda não existe."));
    }
    if (!suportaPush()) {
      return passo(2, "Aviso no celular",
        "Este navegador não recebe aviso. No iPhone use o Safari, no Android o Chrome, " +
        "e instale a escala na tela de início.");
    }
    if (permissao() === "denied") {
      return passo(2, "Liberar o aviso",
        "O aviso está bloqueado para este site. Libere nos ajustes do navegador " +
        "e ligue de novo pelo Perfil.");
    }
    return passo(2, "Liberar o aviso",
      "Você fica sabendo de troca, cessão e plantão vago sem precisar abrir o app.",
      h("button", {
        class: "btn btn-primary btn-sm",
        onclick: async (e) => {
          e.target.disabled = true;
          const r = await ativarPush();
          toast(r.ok ? "Aviso ligado." : r.motivo);
          e.target.disabled = false;
          if (r.ok) e.target.replaceWith(h("span", { class: "chip ok" }, "ligado"));
        },
      }, icon("bell"), "Ligar o aviso"));
  };

  estado.append(passoInstalar(), passoAviso(), h("div", { class: "bv-fim" },
    h("div", { class: "bv-fim-t" }, "Depois disso, no dia a dia"),
    h("ul", { class: "bv-lista" },
      h("li", null, h("b", null, "Escala"), ": quem está de plantão agora e o mês inteiro"),
      h("li", null, h("b", null, "Meus"), ": seus plantões, com data, turno e horário"),
      h("li", null, h("b", null, "Mural"), ": plantões vagos, cedidos e oferecidos para troca"),
      h("li", null, h("b", null, "Pendente"), ": trocas esperando a sua confirmação"),
      h("li", null, "Toque em qualquer plantão para ceder, trocar ou ver quem está"))));

  modal({
    title: "Bem-vindo à escala",
    body: h("div", { class: "bv" },
      h("p", { class: "bv-intro" },
        "Dois passos rápidos deixam a escala funcionando como aplicativo no seu telefone."),
      estado),
    onClose: marcarVisto,
    actions: (close) => [
      h("button", { class: "btn btn-primary btn-block", onclick: close }, "Entendi"),
    ],
  });
}

const marca = (nome) => h("span", { class: "install-ic" }, icon(nome));

const passo = (n, titulo, texto, acao) =>
  h("div", { class: "bv-passo" },
    h("span", { class: "bv-num mono" }, String(n)),
    h("div", { class: "grow" },
      h("div", { class: "bv-t" }, titulo),
      h("div", { class: "bv-d" }, texto),
      acao && h("div", { style: { marginTop: "8px" } }, acao)));

const passoPronto = (texto) =>
  h("div", { class: "bv-passo pronto" },
    h("span", { class: "bv-num" }, icon("check")),
    h("div", { class: "grow" }, h("div", { class: "bv-d" }, texto)));
