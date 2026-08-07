# Escala UTI

Aplicativo de escala de plantão das UTIs do Hospital Oto Santos Dumont.
Roda no navegador, instala na tela de início do celular e funciona como app.

Site estático no GitHub Pages, banco e login no Supabase. Não tem etapa de build:
os arquivos do repositório são exatamente o que vai para o ar.

## O que ele faz

- **Escala fixa em ciclo.** A escala se repete a cada 14 dias. O sistema projeta o
  ciclo para frente e para trás, então qualquer data do calendário já sabe quem é o
  plantonista, sem ninguém precisar lançar mês a mês.
- **Quatro UTIs, três turnos.** UTI 1, UTI 2, UTI 3A e UTI 3B. Manhã (M) das 07h às 13h,
  Tarde (T) das 13h às 19h, Noite (SN) das 19h às 07h do dia seguinte.
- **Diaristas.** Médico fixo de uma UTI em dias combinados da semana, numa faixa
  separada dos plantões de turno.
- **Trocas e cessões com dupla confirmação.** Nenhuma alteração entra no calendário
  sem que os dois médicos envolvidos confirmem.
- **Mural.** Plantões que alguém está cedendo e plantões oferecidos para troca ficam
  visíveis para a equipe pegar ou propor.
- **Foto de rosto.** Cada médico envia a própria foto, que aparece no calendário no
  dia em que está de plantão.
- **Multi-tenant.** Tudo é separado por organização. O mesmo sistema atende outros
  hospitais sem misturar dados, e um médico pode participar de mais de uma escala.

## Como a escala é resolvida

A escala fixa fica em `rotations` (o ciclo e a data âncora) e `rotation_slots`
(quem fica em cada posição do ciclo). As trocas não reescrevem a escala fixa:
elas gravam exceções em `shift_overrides`.

A função `schedule_range(org, de, ate)` projeta o ciclo no período pedido e aplica
as exceções por cima. Ela devolve duas colunas de gente:

- `base_member_id`: quem a escala fixa previa
- `member_id`: quem realmente está de plantão

É essa diferença que o calendário mostra como o nome antigo riscado acima do novo.

Como 14 é múltiplo de 7, cada posição do ciclo cai sempre no mesmo dia da semana.
Por isso a tela do administrador mostra "semana A" e "semana B" em vez de
"dia 0 até dia 13".

## Estrutura

```
index.html              casca do app
css/app.css             cores da marca do hospital e componentes
js/config.js            endereço do projeto Supabase e chave publicável
js/store.js             dados, sessão e cache
js/app.js               rotas e navegação
js/views/               telas
supabase/migrations/    banco: tabelas, funções e permissões
supabase/functions/     criação de contas com privilégio de administrador
```

## Instalar no celular

Abrir o site no navegador, tocar em compartilhar e escolher
**Adicionar à Tela de Início**. O ícone e o nome já vêm configurados.

## Segurança

A chave em `js/config.js` é a chave publicável, feita para ficar exposta no
navegador. Quem protege os dados são as regras de acesso do banco: sem login não
se lê nada, e um plantonista não consegue editar a escala fixa, se promover a
administrador nem gravar alteração direta no calendário. Trocas e cessões só
acontecem pelas funções do banco, que conferem quem é o dono do plantão e exigem
as duas confirmações.

Cadastro público está desligado. Contas são criadas pela coordenação.

## Banco

Aplicar as migrações em ordem, no editor de SQL do Supabase:

```
supabase/migrations/0001_schema.sql
supabase/migrations/0002_functions.sql
supabase/migrations/0003_rls.sql
supabase/migrations/0004_storage.sql
```

A função de criação de contas vai com a CLI do Supabase:

```bash
supabase functions deploy admin-users --project-ref SEU_PROJETO
```
