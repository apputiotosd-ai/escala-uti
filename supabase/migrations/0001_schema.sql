-- =============================================================
-- Escala UTI  |  0001  estrutura de dados
-- Multi-tenant: tudo pendurado em organizations.id (org_id)
-- =============================================================

create extension if not exists pgcrypto;
create extension if not exists citext;
create extension if not exists btree_gist;

-- ---------- tipos ----------
do $$ begin
  create type public.org_role        as enum ('admin','doctor');
exception when duplicate_object then null; end $$;

do $$ begin
  -- M  manha   07:00-13:00
  -- T  tarde   13:00-19:00
  -- SN noite   19:00-07:00 do dia seguinte
  create type public.shift_code      as enum ('M','T','SN');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.exchange_kind   as enum ('swap','giveaway');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.exchange_status as enum ('pending','approved','rejected','cancelled','expired');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.offer_status    as enum ('open','taken','cancelled','expired');
exception when duplicate_object then null; end $$;


-- ---------- organizacoes (tenants) ----------
create table if not exists public.organizations (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique,
  name                    text not null,
  short_name              text,
  timezone                text not null default 'America/Fortaleza',
  -- padrao do ciclo para novas escalas desta organizacao
  cycle_days              smallint not null default 14 check (cycle_days between 1 and 56),
  -- se true, alem dos dois medicos a troca ainda passa pelo administrador
  require_admin_approval  boolean not null default false,
  -- se true, quem pega um plantao cedido assume na hora, sem confirmacao do dono
  giveaway_auto_accept    boolean not null default false,
  -- quantos dias de antecedencia minima para abrir troca ou cessao
  min_notice_hours        smallint not null default 0,
  created_at              timestamptz not null default now()
);

comment on column public.organizations.require_admin_approval is
  'Quando true, exchanges so sao aplicadas apos admin_approved_at.';


-- ---------- unidades (as UTIs) ----------
create table if not exists public.units (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  sort_order smallint not null default 0,
  is_active  boolean not null default true,
  unique (org_id, name)
);
create index if not exists units_org_idx on public.units(org_id);


-- ---------- pessoas ----------
-- Um member existe mesmo sem conta de login (user_id null).
-- Isso permite montar a escala fixa inteira antes de criar os acessos.
create table if not exists public.members (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  full_name    text not null,
  display_name text,                      -- nome curto para caber no calendario
  registro     text,                      -- registro profissional / CRM
  email        citext,
  phone        text,
  avatar_path  text,                      -- caminho no bucket 'avatars'
  role         public.org_role not null default 'doctor',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists members_org_idx     on public.members(org_id);
create index if not exists members_user_idx    on public.members(user_id);
create unique index if not exists members_org_email_idx
  on public.members(org_id, email) where email is not null;


-- ---------- escala fixa, versionada por periodo de vigencia ----------
-- Guardar versoes evita que uma edicao da escala mude o passado.
create table if not exists public.rotations (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  name           text not null,
  cycle_days     smallint not null default 14 check (cycle_days between 1 and 56),
  anchor_date    date not null,          -- data que corresponde ao dia 0 do ciclo
  effective_from date not null,
  effective_to   date,                   -- null = vigente por tempo indeterminado
  is_published   boolean not null default false,
  notes          text,
  created_by     uuid references public.members(id) on delete set null,
  created_at     timestamptz not null default now(),
  constraint rotations_period_ck check (effective_to is null or effective_to >= effective_from)
);
create index if not exists rotations_org_idx on public.rotations(org_id);

-- duas escalas publicadas nao podem valer para o mesmo dia
alter table public.rotations drop constraint if exists rotations_no_overlap;
alter table public.rotations add constraint rotations_no_overlap
  exclude using gist (
    org_id with =,
    daterange(effective_from, effective_to, '[]') with &&
  ) where (is_published);


-- ---------- as celulas da escala fixa ----------
create table if not exists public.rotation_slots (
  id          uuid primary key default gen_random_uuid(),
  rotation_id uuid not null references public.rotations(id) on delete cascade,
  unit_id     uuid not null references public.units(id) on delete cascade,
  day_index   smallint not null check (day_index >= 0 and day_index < 56),
  shift       public.shift_code not null,
  member_id   uuid references public.members(id) on delete set null,  -- null = vago
  unique (rotation_id, unit_id, day_index, shift)
);
create index if not exists rotation_slots_rot_idx    on public.rotation_slots(rotation_id);
create index if not exists rotation_slots_member_idx on public.rotation_slots(member_id);


-- ---------- diaristas ----------
-- Medico fixo de uma UTI em dias de semana. Nao ocupa turno M/T/SN.
create table if not exists public.daily_rounds (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  unit_id        uuid not null references public.units(id) on delete cascade,
  member_id      uuid not null references public.members(id) on delete cascade,
  weekdays       smallint[] not null default '{1,2,3,4,5}',   -- ISO: 1=segunda .. 7=domingo
  effective_from date not null default current_date,
  effective_to   date,
  created_at     timestamptz not null default now(),
  constraint daily_rounds_period_ck check (effective_to is null or effective_to >= effective_from)
);
create index if not exists daily_rounds_org_idx on public.daily_rounds(org_id);


-- ---------- alteracoes pontuais sobre a escala fixa ----------
-- Resultado de troca, cessao ou ajuste do administrador.
create table if not exists public.shift_overrides (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  unit_id          uuid not null references public.units(id) on delete cascade,
  work_date        date not null,
  shift            public.shift_code not null,
  member_id        uuid references public.members(id) on delete set null,  -- null = plantao descoberto
  origin_member_id uuid references public.members(id) on delete set null,  -- quem estava antes
  reason           text not null default 'admin' check (reason in ('troca','cessao','admin')),
  exchange_id      uuid,
  note             text,
  created_by       uuid references public.members(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (org_id, unit_id, work_date, shift)
);
create index if not exists shift_overrides_lookup_idx
  on public.shift_overrides(org_id, work_date);
create index if not exists shift_overrides_member_idx
  on public.shift_overrides(member_id);


-- ---------- mural: plantoes oferecidos ----------
create table if not exists public.offers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  kind        public.exchange_kind not null,   -- giveaway = cedendo / swap = quero trocar
  owner_id    uuid not null references public.members(id) on delete cascade,
  unit_id     uuid not null references public.units(id) on delete cascade,
  work_date   date not null,
  shift       public.shift_code not null,
  note        text,
  wanted_note text,                            -- so para swap: que data eu aceito em troca
  status      public.offer_status not null default 'open',
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
-- um mesmo plantao nao pode estar anunciado duas vezes ao mesmo tempo
create unique index if not exists offers_one_open_idx
  on public.offers(org_id, unit_id, work_date, shift) where status = 'open';
create index if not exists offers_org_status_idx on public.offers(org_id, status, work_date);


-- ---------- pedidos de troca / cessao, com dupla aprovacao ----------
create table if not exists public.exchanges (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  kind             public.exchange_kind not null,
  offer_id         uuid references public.offers(id) on delete set null,

  -- lado de quem esta entregando o plantao
  from_member_id   uuid not null references public.members(id) on delete cascade,
  from_unit_id     uuid not null references public.units(id)   on delete cascade,
  from_date        date not null,
  from_shift       public.shift_code not null,

  -- lado de quem recebe. Em troca, tambem entrega o plantao abaixo.
  to_member_id     uuid not null references public.members(id) on delete cascade,
  to_unit_id       uuid references public.units(id) on delete cascade,
  to_date          date,
  to_shift         public.shift_code,

  note             text,
  status           public.exchange_status not null default 'pending',
  from_approved_at timestamptz,
  to_approved_at   timestamptz,
  admin_approved_at timestamptz,
  decided_by       uuid references public.members(id) on delete set null,
  decided_reason   text,
  applied_at       timestamptz,
  created_by       uuid not null references public.members(id) on delete cascade,
  created_at       timestamptz not null default now(),

  constraint exchanges_swap_needs_other_shift check (
    kind = 'giveaway'
    or (to_unit_id is not null and to_date is not null and to_shift is not null)
  ),
  constraint exchanges_distinct_people check (from_member_id <> to_member_id)
);
create index if not exists exchanges_org_status_idx on public.exchanges(org_id, status);
create index if not exists exchanges_from_idx       on public.exchanges(from_member_id, status);
create index if not exists exchanges_to_idx         on public.exchanges(to_member_id, status);

alter table public.shift_overrides
  drop constraint if exists shift_overrides_exchange_fk;
alter table public.shift_overrides
  add constraint shift_overrides_exchange_fk
  foreign key (exchange_id) references public.exchanges(id) on delete set null;


-- ---------- avisos ----------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  exchange_id uuid references public.exchanges(id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists notifications_member_idx
  on public.notifications(member_id, read_at, created_at desc);


-- ---------- updated_at ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists members_touch on public.members;
create trigger members_touch before update on public.members
  for each row execute function public.touch_updated_at();
