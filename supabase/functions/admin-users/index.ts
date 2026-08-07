// =============================================================
// admin-users
// Criacao e manutencao de contas de acesso, so para administradores.
// A chave de servico nunca sai daqui: ela vive no ambiente da funcao.
// =============================================================
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// Senha provisoria legivel: 3 blocos separados por hifen.
// Sem caracteres que se confundem na leitura (0/O, 1/l/I).
function tempPassword(): string {
  const alpha = "abcdefghjkmnpqrstuvwxyz";
  const num = "23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let i = 0;
  const pick = (set: string, n: number) =>
    Array.from({ length: n }, () => set[bytes[i++] % set.length]).join("");
  return `${pick(alpha, 4)}-${pick(num, 4)}-${pick(alpha, 4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Metodo nao suportado." }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Sem credencial." }, 401);

  // cliente com a identidade de quem chamou: respeita RLS
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await caller.auth.getUser();
  if (userErr || !userData?.user) return json({ error: "Sessao invalida." }, 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Corpo invalido." }, 400);
  }

  const action = String(body.action ?? "");
  const orgId = String(body.org_id ?? "");
  if (!orgId) return json({ error: "Informe a organizacao." }, 400);

  // o proprio banco decide se quem chamou e administrador
  const { data: isAdmin, error: adminErr } = await caller.rpc("is_admin", { p_org: orgId });
  if (adminErr) return json({ error: adminErr.message }, 400);
  if (!isAdmin) return json({ error: "Apenas o administrador pode fazer isso." }, 403);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---------------------------------------------------------
  // criar acesso para um medico ja cadastrado na escala
  // ---------------------------------------------------------
  if (action === "create") {
    const memberId = String(body.member_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!memberId || !email) return json({ error: "Informe o medico e o email." }, 400);

    const { data: member, error: mErr } = await admin
      .from("members")
      .select("id, org_id, full_name, user_id")
      .eq("id", memberId)
      .eq("org_id", orgId)
      .single();
    if (mErr || !member) return json({ error: "Medico nao encontrado nesta escala." }, 404);
    if (member.user_id) return json({ error: "Este medico ja tem acesso." }, 409);

    const password = tempPassword();
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { must_change_password: true, full_name: member.full_name },
    });

    if (cErr) {
      // email ja existe em outra organizacao: aproveita a mesma conta
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list?.users?.find((u) => u.email?.toLowerCase() === email);
      if (!existing) return json({ error: cErr.message }, 400);

      const { error: linkErr } = await admin
        .from("members")
        .update({ user_id: existing.id, email })
        .eq("id", memberId);
      if (linkErr) return json({ error: linkErr.message }, 400);
      return json({ ok: true, linked_existing: true, password: null });
    }

    const { error: linkErr } = await admin
      .from("members")
      .update({ user_id: created.user.id, email })
      .eq("id", memberId);
    if (linkErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return json({ error: linkErr.message }, 400);
    }

    return json({ ok: true, password, email });
  }

  // ---------------------------------------------------------
  // gerar nova senha provisoria
  // ---------------------------------------------------------
  if (action === "reset_password") {
    const memberId = String(body.member_id ?? "");
    const { data: member } = await admin
      .from("members").select("user_id").eq("id", memberId).eq("org_id", orgId).single();
    if (!member?.user_id) return json({ error: "Este medico ainda nao tem acesso." }, 404);

    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(member.user_id, {
      password,
      user_metadata: { must_change_password: true },
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, password });
  }

  // ---------------------------------------------------------
  // tirar o acesso sem apagar o historico de plantoes
  // ---------------------------------------------------------
  if (action === "revoke") {
    const memberId = String(body.member_id ?? "");
    const { data: member } = await admin
      .from("members").select("user_id").eq("id", memberId).eq("org_id", orgId).single();
    if (!member?.user_id) return json({ error: "Este medico nao tem acesso ativo." }, 404);

    await admin.auth.admin.deleteUser(member.user_id);
    const { error } = await admin
      .from("members").update({ user_id: null }).eq("id", memberId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "Acao desconhecida." }, 400);
});
