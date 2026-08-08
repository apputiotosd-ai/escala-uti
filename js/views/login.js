import { h, toast } from "../lib/dom.js";
import { icon } from "../lib/icons.js";
import { sb, niceError } from "../store.js";
import {
  isStandalone, isIOS, isAndroid, canPrompt, promptInstall, onInstallChange,
} from "../lib/install.js";

const mark = () => [
  h("img", { class: "login-logo logo-light", src: "./assets/logo.png",
             alt: "Hospital Oto Santos Dumont", width: 560, height: 238 }),
  h("img", { class: "login-logo logo-dark", src: "./assets/logo-light.png",
             alt: "", "aria-hidden": "true", width: 560, height: 238 }),
];

export function loginView(onDone, aviso = null) {
  const err = h("div",
    aviso && h("div", { class: "err", style: { margin: "0 0 12px" }, role: "status" }, aviso));
  const email = h("input", { class: "inp", type: "email", autocomplete: "username",
                             inputmode: "email", required: true, placeholder: "seu@email.com" });
  const pass = h("input", { class: "inp", type: "password", autocomplete: "current-password",
                            required: true, minlength: 6 });
  const btn = h("button", { class: "btn btn-primary btn-block", type: "submit" }, "Entrar");

  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      err.replaceChildren();
      btn.disabled = true; btn.textContent = "Entrando";
      const { error } = await sb.auth.signInWithPassword({
        email: email.value.trim().toLowerCase(), password: pass.value,
      });
      btn.disabled = false; btn.textContent = "Entrar";
      if (error) {
        err.replaceChildren(h("div", { class: "err", style: { margin: "0 0 12px" } },
          /invalid login/i.test(error.message)
            ? "Email ou senha não conferem."
            : niceError(error)));
        return;
      }
      onDone();
    },
  },
    h("label", { class: "f" }, h("span", null, "Email"), email),
    h("label", { class: "f" }, h("span", null, "Senha"), pass),
    btn);

  return h("div", { class: "login" },
    h("div", { class: "login-box" },
      mark(),
      h("h2", null, "Escala UTI"),
      h("p", { class: "sub" },
        "Entre com o email e a senha que a coordenação passou para você."),
      err,
      form,
      h("p", { class: "meta", style: { marginTop: "18px", lineHeight: "1.5" } },
        "Esqueceu a senha? A coordenação gera uma nova para você na tela de médicos."),
      installCard()));
}

/**
 * Como deixar a escala como aplicativo no telefone.
 * Some sozinho depois de instalado.
 */
function installCard() {
  if (isStandalone()) return null;

  const box = h("div", { class: "install" });

  const paint = () => {
    const kids = [
      h("div", { class: "install-h" },
        icon("install"),
        h("span", null, "Deixe a escala como aplicativo no seu telefone")),
    ];

    if (canPrompt()) {
      // Chrome e Edge instalam com um toque
      kids.push(
        h("p", { class: "install-p" },
          "Assim ela abre direto, sem passar pelo navegador."),
        h("button", {
          class: "btn btn-primary btn-block", style: { marginTop: "10px" },
          onclick: async (e) => {
            e.target.disabled = true;
            const ok = await promptInstall();
            e.target.disabled = false;
            if (ok) toast("Pronto. O ícone já está na sua tela.");
          },
        }, icon("install"), "Instalar agora"));
    } else if (isIOS()) {
      kids.push(
        h("ol", { class: "install-steps" },
          h("li", null, "Toque em ", stepIcon("share"),
            " na barra de baixo do Safari"),
          h("li", null, "Deslize a lista e escolha ",
            h("span", { class: "strong" }, "Adicionar a Tela de Início")),
          h("li", null, "Confirme em ", h("span", { class: "strong" }, "Adicionar"))),
        h("p", { class: "install-p" },
          "No iPhone isso só funciona pelo Safari."));
    } else if (isAndroid()) {
      kids.push(
        h("ol", { class: "install-steps" },
          h("li", null, "Toque em ", stepIcon("dots"),
            " no canto do navegador"),
          h("li", null, "Escolha ",
            h("span", { class: "strong" }, "Instalar aplicativo"),
            " ou ", h("span", { class: "strong" }, "Adicionar a tela inicial"))));
    } else {
      kids.push(
        h("p", { class: "install-p" },
          "Abra este endereco no seu celular para instalar o aplicativo. ",
          "No computador, o navegador oferece a instalação pelo icone na barra de endereco."));
    }

    box.replaceChildren(...kids);
  };

  paint();
  onInstallChange(paint);      // o Chrome pode avisar depois que a tela ja apareceu
  return box;
}

const stepIcon = (name) =>
  h("span", { class: "install-ic" }, icon(name));

export function changePasswordView(onDone) {
  const err = h("div");
  const p1 = h("input", { class: "inp", type: "password", autocomplete: "new-password",
                          required: true, minlength: 8 });
  const p2 = h("input", { class: "inp", type: "password", autocomplete: "new-password",
                          required: true, minlength: 8 });
  const btn = h("button", { class: "btn btn-primary btn-block", type: "submit" }, "Salvar senha");

  const form = h("form", {
    onsubmit: async (e) => {
      e.preventDefault();
      err.replaceChildren();
      if (p1.value !== p2.value) {
        err.replaceChildren(h("div", { class: "err", style: { margin: "0 0 12px" } },
          "As duas senhas precisam ser iguais."));
        return;
      }
      btn.disabled = true; btn.textContent = "Salvando";
      const { error } = await sb.auth.updateUser({
        password: p1.value,
        data: { must_change_password: false },
      });
      btn.disabled = false; btn.textContent = "Salvar senha";
      if (error) {
        err.replaceChildren(h("div", { class: "err", style: { margin: "0 0 12px" } }, niceError(error)));
        return;
      }
      toast("Senha trocada.");
      onDone();
    },
  },
    h("label", { class: "f" }, h("span", null, "Nova senha"), p1),
    h("label", { class: "f" }, h("span", null, "Repita a nova senha"), p2),
    btn);

  return h("div", { class: "login" },
    h("div", { class: "login-box" },
      mark(),
      h("h2", null, "Crie sua senha"),
      h("p", { class: "sub" },
        "Você entrou com a senha provisória. Escolha uma senha sua, com pelo menos 8 caracteres."),
      err,
      form));
}
