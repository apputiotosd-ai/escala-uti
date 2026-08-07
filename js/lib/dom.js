// Construtor de elementos. Tudo entra como texto, nunca como HTML,
// entao nome de medico com caractere especial nao quebra nem injeta nada.

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props && (props.nodeType || typeof props !== "object" || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  for (const k in props || {}) {
    const v = props[k];
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "html") el.innerHTML = v;              // so para icones proprios
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k in el && k !== "list" && typeof v !== "boolean") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  add(el, kids);
  return el;
}

function add(el, kids) {
  for (const c of kids) {
    if (c === null || c === undefined || c === false || c === true) continue;
    if (Array.isArray(c)) add(el, c);
    else el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function mount(parent, ...kids) {
  clear(parent);
  add(parent, kids);
  return parent;
}

// ---------- avisos rapidos ----------
let toastTimer;
export function toast(msg, ms = 2800) {
  document.querySelector(".toast")?.remove();
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

// ---------- janela modal ----------
export function modal({ title, body, actions, onClose }) {
  const mask = h("div", { class: "mask" });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    mask.remove();
    document.removeEventListener("keydown", onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };

  const box = h("div", { class: "modal", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "bar" }, title,
      h("button", {
        class: "btn-icon", style: { color: "inherit", padding: "0" },
        "aria-label": "Fechar", onclick: close, html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M18 6 6 18M6 6l12 12"/></svg>',
      })),
    h("div", { class: "modal-b" }, body),
    actions && h("div", { class: "modal-f" }, actions(close)));

  mask.append(box);
  mask.addEventListener("click", (e) => { if (e.target === mask) close(); });
  document.addEventListener("keydown", onKey);
  document.body.append(mask);
  box.querySelector("input,select,textarea,button")?.focus();
  return close;
}

export function confirmBox(title, message, okLabel = "Confirmar") {
  return new Promise((resolve) => {
    let answer = false;
    modal({
      title,
      body: h("p", { style: { margin: "2px 0 4px", fontSize: "14px" } }, message),
      onClose: () => resolve(answer),
      actions: (close) => [
        h("button", { class: "btn", onclick: close }, "Voltar"),
        h("button", { class: "btn btn-primary", onclick: () => { answer = true; close(); } }, okLabel),
      ],
    });
  });
}
