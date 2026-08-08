import { h, mount, toast } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { S, sb, loadRefs, niceError, loadNotifications, isAdmin } from "../store.js";
import { avatar, emptyState } from "../lib/ui.js";
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
    placeholder: "Como seu nome aparece no calendario", maxlength: 24 });
  const phone = h("input", { class: "inp", value: me.phone || "",
    type: "tel", inputmode: "tel", placeholder: "(85) 90000-0000" });

  const avaBox = h("div", { class: "card-row", style: { gap: "14px" } });
  const renderAva = () => mount(avaBox,
    avatar(S.me.id, "xl"),
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
      h("label", { class: "f" }, h("span", null, "Nome curto no calendario"), display),
      h("label", { class: "f" }, h("span", null, "Telefone"), phone),
      h("button", {
        class: "btn btn-primary btn-block",
        onclick: async (e) => {
          e.target.disabled = true;
          // manda o texto como esta: vazio significa apagar, e nao "nao mexe"
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

    h("div", { style: { padding: "18px 12px 30px" } },
      isAdmin() && h("a", { class: "btn btn-block", href: "#/admin",
        style: { marginBottom: "8px" } }, icon("cog"), "Area da coordenacao"),
      h("button", { class: "btn btn-block", onclick: signOut }, icon("out"), "Sair"),
      h("p", { class: "meta", style: { textAlign: "center", marginTop: "16px", lineHeight: "1.6" } },
        "Para instalar no celular: abra no navegador, toque em compartilhar e escolha ",
        h("span", { class: "strong" }, "Adicionar a Tela de Inicio"), ".")));
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
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("Nao consegui processar a imagem."))),
               "image/jpeg", 0.85);
    };
    img.onerror = () => reject(new Error("Arquivo de imagem invalido."));
    img.src = URL.createObjectURL(file);
  });
}
