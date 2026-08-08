import { h, mount, toast } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { S, sb, loadRefs, niceError, loadNotifications, isAdmin } from "../store.js";
import { avatarAmpliavel, emptyState } from "../lib/ui.js";
import { br } from "../lib/dates.js";
import { signOut } from "../app.js";

export async function profileView() {
  const root = h("div");
  await paint(root);
  return root;
}

async function paint(root) {
  const notes = await loadNotifications().catch(() => []);
  const me = S.byId.get(S.me.id) || S.me;

  const display = h("input", { class: "inp", value: me.display_name || "",
    placeholder: "Como seu nome aparece no calendário", maxlength: 24 });
  const phone = h("input", { class: "inp", value: me.phone || "",
    type: "tel", inputmode: "tel", placeholder: "(85) 90000-0000" });

  const avaBox = h("div", { class: "card-row", style: { gap: "14px" } });
  const renderAva = () => mount(avaBox,
    avatarAmpliavel(S.me.id, "xl"),
    h("div", { class: "grow" },
      h("div", { class: "strong" }, me.full_name),
      me.registro && h("div", { class: "meta mono" }, "Registro " + me.registro),
      h("div", { class: "meta" }, me.email || S.user.email),
      h("label", { class: "btn btn-sm", style: { marginTop: "8px" } },
        icon("camera"), "Trocar foto",
        h("input", {
          type: "file", accept: "image/jpeg,image/png,image/webp",
          class: "sr", onchange: (e) => upload(e.target.files[0], renderAva),
        }))));
  renderAva();

  mount(root,
    h("div", { class: "bar" }, h("span", null, "Meu perfil")),
    h("div", { class: "card" }, h("div", { class: "card-b" }, avaBox)),

    h("div", { class: "card" }, h("div", { class: "card-b" },
      h("label", { class: "f" }, h("span", null, "Nome curto no calendário"), display),
      h("label", { class: "f" }, h("span", null, "Telefone"), phone),
      h("button", {
        class: "btn btn-primary btn-block",
        onclick: async (e) => {
          e.target.disabled = true;
          // manda o texto como esta: vazio significa apagar, e nao "não mexe"
          const { error } = await sb.rpc("update_my_profile", {
            p_org: S.org.id,
            p_display_name: display.value.trim(),
            p_phone: phone.value.trim(),
            p_avatar_path: null,
          });
          e.target.disabled = false;
          if (error) return toast(niceError(error));
          await loadRefs();
          toast("Salvo.");
        },
      }, "Salvar"))),

    h("div", { class: "bar", style: { marginTop: "16px" } }, h("span", null, "Aviso no celular")),
    blocoPush(),

    h("div", { class: "bar", style: { marginTop: "16px" } },
      h("span", null, "Avisos"),
      notes.some((n) => !n.read_at) && h("button", {
        class: "btn btn-sm", style: { padding: "2px 8px", fontSize: "11px" },
        onclick: async () => {
          await sb.from("notifications").update({ read_at: new Date().toISOString() })
            .eq("member_id", S.me.id).is("read_at", null);
          paint(root);
        },
      }, "Marcar como lidos")),
    notes.length
      ? h("div", { class: "adminlist" }, notes.map(noteRow))
      : emptyState("Nenhum aviso.", "bell"),

    h("div", { style: { padding: "10px 12px 0" } },
      h("button", {
        class: "btn btn-block",
        onclick: async () => {
          const { abrirBoasVindas } = await import("./boas-vindas.js");
          abrirBoasVindas({ forcado: true });
        },
      }, icon("install"), "Ver o passo a passo de instalação e aviso")),

    h("div", { style: { padding: "18px 12px 30px" } },
      isAdmin() && h("a", { class: "btn btn-block", href: "#/admin",
        style: { marginBottom: "8px" } }, icon("cog"), "Área da coordenação"),
      h("button", { class: "btn btn-block", onclick: signOut }, icon("out"), "Sair"),
      h("p", { class: "meta", style: { textAlign: "center", marginTop: "16px", lineHeight: "1.6" } },
        "Para instalar no celular: abra no navegador, toque em compartilhar e escolha ",
        h("span", { class: "strong" }, "Adicionar a Tela de Início"), ".")));
}

/**
 * Liga o aviso no aparelho. Precisa vir de um toque da pessoa: navegador
 * nenhum concede permissao de notificacao sem gesto.
 */
function blocoPush() {
  const caixa = h("div", { class: "card" });

  const pintar = async () => {
    const { suportaPush, precisaInstalar, permissao, inscricaoAtual,
            ativarPush, desativarPush, meusAparelhos } = await import("../lib/push.js");

    // iPhone sem instalar vem PRIMEIRO: no Safari o recurso de aviso nem
    // existe ainda, e dizer "não suporta" confundiria quem só falta instalar
    if (precisaInstalar()) {
      return mount(caixa, h("div", { class: "card-b" },
        h("div", { class: "strong", style: { fontSize: "13.5px" } },
          "Primeiro instale o app, depois ligue o aviso"),
        h("div", { class: "meta", style: { marginTop: "6px", lineHeight: "1.6" } },
          "No iPhone o aviso só existe com o app na tela de início. A ordem é:"),
        h("ol", { class: "install-steps", style: { marginTop: "6px" } },
          h("li", null, "Toque em ", h("span", { class: "install-ic" }, icon("share")),
            " na barra de baixo do Safari"),
          h("li", null, "Escolha ", h("span", { class: "strong" }, "Adicionar à Tela de Início")),
          h("li", null, "Abra a escala pelo ", h("span", { class: "strong" }, "ícone novo"),
            ", volte aqui e ligue o aviso")),
        h("div", { class: "meta", style: { marginTop: "8px" } },
          "É assim no iPhone para qualquer site, não é limitação da escala.")));
    }
    if (!suportaPush()) {
      return mount(caixa, h("div", { class: "card-b meta" },
        "Este navegador não recebe aviso. No iPhone use o Safari, no Android use o Chrome, ",
        "e instale a escala na tela de início."));
    }

    const sub = await inscricaoAtual();
    const aparelhos = sub ? await meusAparelhos() : [];
    const bloqueado = permissao() === "denied";

    mount(caixa, h("div", { class: "card-b" },
      h("div", { class: "card-row", style: { gap: "10px" } },
        icon("bell", "grow-0"),
        h("div", { class: "grow" },
          h("div", { class: "strong", style: { fontSize: "13.5px" } },
            sub ? "Aviso ligado neste aparelho" : "Aviso desligado"),
          h("div", { class: "meta", style: { lineHeight: "1.5" } },
            sub
              ? "Você recebe aviso de troca, cessão e plantão vago mesmo com o app fechado."
              : bloqueado
                ? "Você bloqueou o aviso para este site. Libere nos ajustes do navegador."
                : "Ligue para saber de troca e cessão sem precisar abrir o app.")),
        h("button", {
          class: sub ? "btn btn-sm" : "btn btn-sm btn-primary",
          disabled: bloqueado && !sub,
          onclick: async (e) => {
            e.target.disabled = true;
            if (sub) {
              await desativarPush();
              toast("Aviso desligado neste aparelho.");
            } else {
              const r = await ativarPush();
              toast(r.ok ? "Aviso ligado." : r.motivo);
            }
            pintar();
          },
        }, sub ? "Desligar" : "Ligar")),

      aparelhos.length > 1 && h("div", { class: "meta", style: { marginTop: "10px" } },
        `Ligado em ${aparelhos.length} aparelhos: `,
        aparelhos.map((a) => a.aparelho || "aparelho").join(", "))));
  };

  pintar();
  return caixa;
}

const noteRow = (n) => h("div", { class: "arow", style: { opacity: n.read_at ? ".55" : "1" } },
  h("span", { class: "tick", style: { background: n.read_at ? "var(--rule)" : "var(--m)", height: "30px" } }),
  h("div", { class: "grow" },
    h("div", { style: { fontSize: "13.5px", fontWeight: n.read_at ? "400" : "600" } }, n.title),
    n.body && h("div", { class: "meta" }, n.body),
    h("div", { class: "meta mono" }, br(n.created_at.slice(0, 10)))));

/** Recorta no quadrado central e reduz antes de enviar: economiza dado no 4G do hospital. */
async function upload(file, done) {
  if (!file) return;
  try {
    toast("Enviando foto");
    const blob = await squareResize(file, 512);
    const path = `${S.me.id}/rosto.jpg`;
    const { error } = await sb.storage.from("avatars")
      .upload(path, blob, { upsert: true, contentType: "image/jpeg", cacheControl: "60" });
    if (error) throw error;

    const { error: e2 } = await sb.rpc("update_my_profile", {
      p_org: S.org.id, p_display_name: null, p_phone: null,
      p_avatar_path: `${path}?v=${Date.now()}`,
    });
    if (e2) throw e2;

    await loadRefs();
    done();
    toast("Foto atualizada.");
  } catch (e) {
    toast(niceError(e));
  }
}

function squareResize(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Não consegui processar a imagem."))),
               "image/jpeg", 0.85);
    };
    img.onerror = () => reject(new Error("Arquivo de imagem invalido."));
    img.src = URL.createObjectURL(file);
  });
}
