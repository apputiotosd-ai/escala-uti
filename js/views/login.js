import { h, toast } from "../lib/dom.js";
import { sb, niceError } from "../store.js";

const mark = () => [
  h("img", { class: "login-logo logo-light", src: "./assets/logo.png",
             alt: "Hospital Oto Santos Dumont", width: 560, height: 238 }),
  h("img", { class: "login-logo logo-dark", src: "./assets/logo-light.png",
             alt: "", "aria-hidden": "true", width: 560, height: 238 }),
];

export function loginView(onDone) {
  const err = h("div");
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
            ? "Email ou senha nao conferem."
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
        "Entre com o email e a senha que a coordenacao passou para voce."),
      err,
      form,
      h("p", { class: "meta", style: { marginTop: "18px", lineHeight: "1.5" } },
        "Esqueceu a senha? A coordenacao gera uma nova para voce na tela de medicos.")));
}

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
        "Voce entrou com a senha provisoria. Escolha uma senha sua, com pelo menos 8 caracteres."),
      err,
      form));
}
