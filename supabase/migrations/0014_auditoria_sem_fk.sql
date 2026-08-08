-- =============================================================
-- Escala UTI  |  0014  o livro de registro sobrevive ao que documenta
--
-- A auditoria tinha chave estrangeira para organizations e members. Duas
-- consequencias ruins:
--
--   1. Apagar uma organizacao passou a falhar. A cascata apaga as
--      alteracoes de plantao, o gatilho tenta gravar o registro e a chave
--      aponta para a organizacao que esta sendo apagada.
--   2. Apagar um medico zerava a autoria do que ele fez.
--
-- Livro de registro nao deve depender do que registra. Os ids ficam, sem
-- chave estrangeira, e o nome ja e guardado no momento do fato.
-- =============================================================

alter table public.audit_log drop constraint if exists audit_log_org_id_fkey;
alter table public.audit_log drop constraint if exists audit_log_quem_fkey;

comment on column public.audit_log.org_id is
  'Sem chave estrangeira de proposito: o registro sobrevive a exclusao da organizacao.';
comment on column public.audit_log.quem_nome is
  'Nome no momento do fato. E o que resta se a pessoa sair do cadastro.';
