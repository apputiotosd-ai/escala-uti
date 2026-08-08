// =============================================================
// push-send
// Recebe o id de um aviso, monta a mensagem e entrega aos aparelhos
// inscritos do medico. Assina com VAPID e cifra o conteudo conforme o
// padrao Web Push (RFC 8291), usando apenas WebCrypto.
//
// Chamada pelo banco, nao pelo navegador: a barreira e um segredo
// compartilhado no cabecalho, nao o JWT do usuario.
// =============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUB = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIV = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUB = Deno.env.get("VAPID_SUBJECT") ?? "mailto:apputiotosd@gmail.com";
const SEGREDO = Deno.env.get("PUSH_SECRET")!;
const APP_URL = Deno.env.get("APP_URL") ?? "https://apputiotosd.github.io/escala-uti/";

/* ---------------- base64url ---------------- */
const b64uToBytes = (s: string): Uint8Array => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
const bytesToB64u = (b: Uint8Array | ArrayBuffer): string => {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  return btoa(String.fromCharCode(...u)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const concat = (...arr: Uint8Array[]): Uint8Array => {
  const total = arr.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arr) { out.set(a, o); o += a.length; }
  return out;
};

/* ---------------- VAPID: JWT ES256 ---------------- */
async function chavePrivadaVapid(): Promise<CryptoKey> {
  const d = b64uToBytes(VAPID_PRIV);
  const pub = b64uToBytes(VAPID_PUB);          // 0x04 || X(32) || Y(32)
  const jwk = {
    kty: "EC", crv: "P-256", d: bytesToB64u(d),
    x: bytesToB64u(pub.slice(1, 33)), y: bytesToB64u(pub.slice(33, 65)),
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" },
                                 false, ["sign"]);
}

async function cabecalhoVapid(endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64u(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToB64u(new TextEncoder().encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUB,
  })));
  const base = `${header}.${payload}`;
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, await chavePrivadaVapid(),
    new TextEncoder().encode(base));
  return `vapid t=${base}.${bytesToB64u(sig)}, k=${VAPID_PUB}`;
}

/* ---------------- corpo cifrado (aes128gcm) ---------------- */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

async function cifra(texto: string, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const clientePub = b64uToBytes(p256dhB64);
  const authSecret = b64uToBytes(authB64);

  // par efemero do servidor
  const par = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" },
                                              true, ["deriveBits"]);
  const servidorPub = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));

  const clienteKey = await crypto.subtle.importKey(
    "raw", clientePub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: clienteKey }, par.privateKey, 256));

  const enc = new TextEncoder();
  // PRK: mistura o segredo da inscricao com o ECDH
  const prkInfo = concat(enc.encode("WebPush: info\0"), clientePub, servidorPub);
  const ikm = await hkdf(authSecret, ecdh, prkInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const chave = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // o padrao exige um 0x02 fechando o registro antes de cifrar
  const corpo = concat(enc.encode(texto), new Uint8Array([2]));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce }, chave, corpo));

  // cabecalho: salt(16) | rs(4) | idlen(1) | chave publica(65)
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([servidorPub.length]), servidorPub, cifrado);
}

/* ---------------- texto do aviso ---------------- */
function paraOnde(kind: string): string {
  // aviso de mural leva ao mural: e lá que se pega ou se propõe troca
  if (kind.startsWith("offer")) return "#/mural";
  if (kind.startsWith("interest")) return "#/mural";
  if (kind.startsWith("swap") || kind.startsWith("giveaway") || kind.startsWith("exchange")) {
    return "#/pendencias";
  }
  return "#/escala";
}

/**
 * Aviso de mural chega para muita gente ao mesmo tempo. Sem tag propria,
 * um aviso substituiria o outro no aparelho e a pessoa perderia ofertas.
 */
function etiqueta(kind: string, id: string): string {
  return kind.startsWith("offer") ? `offer-${id}` : kind;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-escala-secret") !== SEGREDO) {
    return new Response("nao autorizado", { status: 401 });
  }

  let body: { notification_id?: string };
  try { body = await req.json(); } catch { return new Response("corpo invalido", { status: 400 }); }
  const id = body.notification_id;
  if (!id) return new Response("informe notification_id", { status: 400 });

  const admin = createClient(URL_SB, SERVICE, { auth: { persistSession: false } });

  const { data: aviso, error } = await admin
    .from("notifications")
    .select("id, member_id, kind, title, body, org_id, push_em")
    .eq("id", id).single();
  if (error || !aviso) return new Response("aviso nao encontrado", { status: 404 });
  if (aviso.push_em) return new Response(JSON.stringify({ ok: true, ja_enviado: true }));

  const { data: inscricoes } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("member_id", aviso.member_id);

  if (!inscricoes?.length) {
    await admin.from("notifications")
      .update({ push_em: new Date().toISOString(), push_erro: "sem aparelho inscrito" })
      .eq("id", id);
    return new Response(JSON.stringify({ ok: true, aparelhos: 0 }));
  }

  const payload = JSON.stringify({
    title: aviso.title,
    body: aviso.body ?? "",
    url: APP_URL + paraOnde(aviso.kind ?? ""),
    tag: etiqueta(aviso.kind ?? "", aviso.id),
  });

  let entregues = 0;
  const erros: string[] = [];

  for (const s of inscricoes) {
    try {
      const corpo = await cifra(payload, s.p256dh, s.auth);
      const r = await fetch(s.endpoint, {
        method: "POST",
        headers: {
          "Content-Encoding": "aes128gcm",
          "Content-Type": "application/octet-stream",
          "TTL": "86400",
          "Urgency": "high",
          "Authorization": await cabecalhoVapid(s.endpoint),
        },
        body: corpo,
      });
      if (r.ok) {
        entregues++;
        await admin.from("push_subscriptions")
          .update({ ultimo_ok: new Date().toISOString(), falhas: 0 }).eq("id", s.id);
      } else if (r.status === 404 || r.status === 410) {
        // aparelho desinstalou o app ou revogou: some com a inscricao
        await admin.from("push_subscriptions").delete().eq("id", s.id);
        erros.push(`${r.status} inscricao removida`);
      } else {
        erros.push(`${r.status} ${(await r.text()).slice(0, 80)}`);
        await admin.from("push_subscriptions")
          .update({ falhas: (s as { falhas?: number }).falhas ?? 1 }).eq("id", s.id);
      }
    } catch (e) {
      erros.push(String(e).slice(0, 80));
    }
  }

  await admin.from("notifications").update({
    push_em: new Date().toISOString(),
    push_erro: erros.length ? erros.join(" | ").slice(0, 300) : null,
  }).eq("id", id);

  return new Response(JSON.stringify({ ok: true, entregues, erros }), {
    headers: { "Content-Type": "application/json" },
  });
});
