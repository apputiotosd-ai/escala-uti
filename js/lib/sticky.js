// O cabecalho, a faixa "Agora" e as abas ficam presos no alto, um embaixo do
// outro. Para isso cada um precisa saber a altura do que esta acima dele.
// Medir em JS em vez de chutar um valor: no iPhone com recorte na tela o
// cabecalho cresce com a area segura, e um numero fixo no CSS erraria.

let observador;

function medir() {
  const raiz = document.documentElement.style;
  const topo = document.querySelector(".top");
  const agora = document.querySelector(".now");
  raiz.setProperty("--top-h", `${topo ? topo.offsetHeight : 0}px`);
  raiz.setProperty("--now-h", `${agora ? agora.offsetHeight : 0}px`);
}

/** Chamar depois de montar a tela. Remede sozinho quando algo muda de tamanho. */
export function ajustaTopo() {
  medir();
  observador?.disconnect();
  if (!("ResizeObserver" in window)) return;
  observador = new ResizeObserver(medir);
  for (const sel of [".top", ".now"]) {
    const el = document.querySelector(sel);
    if (el) observador.observe(el);
  }
}

// girar o aparelho muda tudo de altura
addEventListener("resize", medir);
addEventListener("orientationchange", () => setTimeout(medir, 250));
