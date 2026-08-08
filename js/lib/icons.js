// Icones de traco. Sem emoji em lugar nenhum da interface.
import { h } from "./dom.js";

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICONS = {
  grid:    P('<rect x="3" y="4" width="18" height="17" rx="1.5"/><path d="M3 9h18M9 9v12M15 9v12M3 15h18M8 2v4M16 2v4"/>'),
  user:    P('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>'),
  board:   P('<path d="M4 5h16v11H4z"/><path d="M12 16v5M8 21h8M9 9h6M9 12h4"/>'),
  swap:    P('<path d="M4 8h13l-3.2-3.2M20 16H7l3.2 3.2"/>'),
  bell:    P('<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M10.4 20a1.9 1.9 0 0 0 3.2 0"/>'),
  cog:     P('<circle cx="12" cy="12" r="3"/><path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H2a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H8a1.6 1.6 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V8a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  left:    P('<path d="M15 5l-7 7 7 7"/>'),
  right:   P('<path d="M9 5l7 7-7 7"/>'),
  check:   P('<path d="M4 12.5l5.2 5.2L20 7"/>'),
  x:       P('<path d="M18 6 6 18M6 6l12 12"/>'),
  plus:    P('<path d="M12 5v14M5 12h14"/>'),
  hand:    P('<path d="M11 11V4.8a1.4 1.4 0 0 1 2.8 0V11m0-1.2a1.4 1.4 0 0 1 2.8 0V13m0-2a1.4 1.4 0 0 1 2.8 0v4.5A5.5 5.5 0 0 1 13.9 21h-1.4a5 5 0 0 1-3.8-1.7l-3.3-3.8a1.4 1.4 0 0 1 2-2l1.8 1.7V7.2a1.4 1.4 0 0 1 2.8 0V11"/>'),
  clock:   P('<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.3l3.2 1.9"/>'),
  out:     P('<path d="M15 17l5-5-5-5M20 12H9M12 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6"/>'),
  camera:  P('<path d="M3 8.5h3.2l1.6-2.4h8.4l1.6 2.4H21v11H3z"/><circle cx="12" cy="14" r="3.4"/>'),
  key:     P('<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8 2.2 2.2-1.6 1.6 1.6 1.6-2.4 2.4-1.6-1.6-2 2"/>'),
  empty:   P('<path d="M4 6h16v14H4z"/><path d="M4 10h16M8 3v3M16 3v3"/><path d="M9 15h6"/>'),
  warn:    P('<path d="M12 4.5 21 20H3z"/><path d="M12 10v4.2M12 17.2v.1"/>'),
  // icone de compartilhar do iPhone: quadrado com seta saindo por cima
  share:   P('<path d="M12 3.2v11"/><path d="M8.4 6.8 12 3.2l3.6 3.6"/><path d="M7 10.5H5.4v9.3h13.2v-9.3H17"/>'),
  dots:    P('<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>'),
  install: P('<path d="M12 3.5v10.5"/><path d="M8 10.2 12 14l4-3.8"/><path d="M4.5 17.5v2a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1v-2"/>'),
  zoom:    P('<circle cx="10.6" cy="10.6" r="6.4"/><path d="M15.4 15.4 20.5 20.5M8.2 10.6h4.8M10.6 8.2v4.8"/>'),
  // contorno do balao do WhatsApp com o fone dentro
  whats:   P('<path d="M20.3 11.7a8.3 8.3 0 0 1-12.2 7.3L3.7 20.3l1.3-4.4A8.3 8.3 0 1 1 20.3 11.7z"/><path d="M9.2 8.6c.5-.1.8 0 1 .5l.6 1.3c.1.3.1.5-.1.7l-.4.5c-.2.2-.2.4 0 .7a6 6 0 0 0 2.3 2.1c.3.1.5.1.7-.1l.5-.5c.2-.2.4-.2.7-.1l1.3.6c.4.2.6.5.5.9-.1.9-1 1.5-2 1.4a7.7 7.7 0 0 1-6.2-6c-.1-1 .4-1.9 1.1-2.4z"/>'),
};

export const icon = (name, cls) =>
  h("span", { class: cls, style: { display: "inline-flex" }, "aria-hidden": "true", html: ICONS[name] || "" });
