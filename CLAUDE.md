# CLAUDE.md — LoogiRio Frota (antigo "Motoristas por Galpão")

Instruções para o Claude (e para quem mantiver o projeto). Leia antes de mexer.

## O que é

Nome do app: **LoogiRio Frota** (ícone: "Loogi Frota"). Visual: estilo iOS com as cores da LoogiRio (azul #0042F6, laranja #FC6600, marinho #010349), tema claro/escuro (botão no topo; padrão = tema do aparelho). O endereço continua motoristas-por-galpao.vercel.app.


App web mobile-first (pt-BR) em que dispatchers dos galpões SRJ1, SRJ2, SRJ4, SRJ5, SRJ8, SRJ9, SRJ10, SRJ13, SRJ17 e HUB acompanham motoristas e pedem inativações; admins aprovam. Stack: Vite + React + TypeScript + Tailwind + React Router + TanStack Query + supabase-js; backend Supabase (Postgres + RLS, Auth, Edge Functions em Deno, pg_cron, pg_net, Vault). Visão geral e passo a passo de implantação: `README.md`.

- Site: https://motoristas-por-galpao.vercel.app (Vercel, projeto `motoristas-por-galpao`)
- Supabase: project-ref **`idihrzbchxaptjgvsjfu`** (nome `motorista-galpao`, organização grátis `motorista-galpao`, região sa-east-1)

## Regras obrigatórias

1. **Antes de qualquer comando contra o Supabase** (`supabase link`, `db push`, `functions deploy`, `secrets set`, `db query` que grave, Vault), mostre o project-ref `idihrzbchxaptjgvsjfu` e **peça confirmação ao usuário**. A confirmação vale para aquele pedido; não generalize.
2. **Nunca** se conecte ao Supabase de produção da empresa (organização "LoogiRio"; projetos "Loogirio", "loogirio-pagamentos", "Automação Framer"). Também não use o conector MCP do Supabase: ele pode apontar para a conta da empresa. Use só a CLI (`npx supabase ...`). **Única exceção, liberada pelo usuário em 30/10/2026:** a Edge Function `sincronizar-crm` do app lê o CRM (projeto "Loogirio", tabela `cadastros`) só pela visão `app_frota.motoristas`, com o usuário só-leitura `app_frota_leitura`. O Claude continua sem rodar comandos nesse projeto; o SQL de lá (`docs/crm/leitura-app-frota.sql`) quem roda é o usuário.
3. A chave `service_role` nunca vai para o frontend, o repositório, os arquivos `.env` do frontend ou o chat. Nas Edge Functions ela é injetada automaticamente (`SUPABASE_SERVICE_ROLE_KEY`). O frontend usa só `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. Todo SQL vai em `supabase/migrations/` (arquivo novo, numerado em sequência). Não altere o banco pelo painel. Não edite migrações já aplicadas; crie uma nova.
5. Nunca grave dados reais de motoristas no repositório. Testes e seeds usam só dados fictícios.
6. **CPF**: por decisão do usuário (18/10/2026), o CPF é guardado. **Admin vê completo; dispatcher vê só mascarado** (`***.456.789-**`), com o mascaramento feito no banco por privilégio de coluna (migração 0012). O CPF **não** vai para WhatsApp, notificações nem para a aba de movimentações. **RG e endereço nunca** entram no app.
7. Rode `npm run lint`, `npm run build` e `npm run test:rls` antes de dizer que terminou. Para Edge Functions: `npx deno check --node-modules-dir=none supabase/functions/<nome>/index.ts`.
8. Commits em português, com a linha `Co-Authored-By` que a ferramenta indicar.

## Arquivos de segredo (fora do git, só no computador do usuário)

`.env.local`, `supabase/.planilha_sync_token`, `supabase/.notificar_token`, `supabase/.vapid_private`, `supabase/.env.zapi`, `supabase/.crm_leitura_senha`, `supabase/.crm_leitura.sql`, `supabase/.crm_db_url`. Nunca imprima o conteúdo deles no chat. Para cadastrar um segredo, leia o arquivo no próprio comando (ex.: `secrets set "X=$(cat arquivo)"`).

Secrets já cadastrados no Supabase: `APP_ORIGIN`, `PLANILHA_SYNC_TOKEN`, `NOTIFICAR_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`. No Vault: `notificar_url`, `notificar_token`, que ligam os gatilhos de aviso e as tarefas agendadas.

## Decisões de produto (não desfaça sem pedir)

- **Inativação e reativação com aprovação**: dispatcher só **solicita** (`solicitar_inativacao_lote` / `solicitar_reativacao_lote`); admin aprova ou recusa (`decidir_grupo_inativacao`, serve para os dois tipos, coluna `tipo`) depois de atualizar a Coopmetro e o sistema interno. Admin inativa e reativa direto. As duas pedem **motivo** (reativação: `validar_motivo_reativacao`), que fica no pedido e no histórico.
- **Alertas**: cada alerta fica "não lido" até o botão "Marcar como lido" (tabela `alertas_lidos`; abrir a aba não marca nada). Tipos: inativação, ativo sem rota há 20+ dias (`dias_corte_sem_rota()`, "cortar") e pedido do próprio usuário aprovado/recusado. O sino usa `alertas_nao_lidos()`.
- **Várias placas**: cada placa é um cadastro (`codigo`). `pessoa_id` agrupa a mesma pessoa (por CPF; sem CPF, pelo celular). Inativar escolhe quais placas.
- **Planilha "RELAÇÃO INTERNA ATIVOS E INATIVOS"** (Google Sheets) → app via Apps Script (`docs/apps-script/sincronizar-planilha.gs`) e a Edge Function `sincronizar-planilha` (ação `base` → `sincronizar_base_crm`, migração 0023). Desde 28/10/2026 a origem é a aba **BASE - SUPABASE** (exportação do CRM): cada cadastro é identificado pelo `id` do CRM (`motoristas.crm_id`); o código exibido é o ID Coopmetro (sem ele, provisório `CRM-xxxx`). Entram ativo, inativo e pausado (pausado = inativo). O CRM manda no status **só quando ele muda** (`crm_status`), para não desfazer o que foi feito no app. Rotas vêm da aba BASE - POWER BI, somadas por CPF. Só as colunas listadas no script saem da planilha (nunca RG, endereço, filiação, renavam, chassi). As abas ATIVOS e INATIVOS não são mais usadas.
- **CRM direto** (migração 0027, 30/10/2026): os cadastros vêm do CRM pela Edge Function `sincronizar-crm` (pg_cron a cada 5 min, `disparar_sincronizacao_crm`, token `NOTIFICAR_TOKEN`), que lê `app_frota.motoristas` com o secret `CRM_DB_URL` e chama a mesma `sincronizar_base_crm`. As rotas continuam pela aba BASE - POWER BI: o Apps Script manda a ação `rotas` → `sincronizar_rotas_cpf`. `sincronizarBase` (aba BASE - SUPABASE) fica só como reserva manual.
- **Treinamentos** (migração 0024): o admin marca pela skill `/marcar-treinamento` (CRM, Google Agenda, WhatsApp; fica em `~/.claude/skills`, fora do repo). O Apps Script lê as agendas dos galpões (propriedade `AGENDAS_TREINAMENTO`, JSON galpão → ID da agenda; os IDs não vão para o repo), eventos com título "TREINAMENTO ...", de 7 dias atrás a 60 dias à frente, e manda para `sincronizar_treinamentos`; evento apagado vira cancelado. Dispatcher vê só os seus galpões (aba Treinos) e, depois do horário, marca Compareceu/Faltou uma vez, sempre com comentário (`marcar_presenca_treinamento`, migração 0026); admin corrige. Avisos: treinamento novo → push e alerta `trein:` para dispatchers do galpão; "Faltou" → push e alerta `falta:` para admins. O app não marca treinamento nem mexe no CRM.
- **Avisos**: notificações push do site (Web Push/VAPID) pela função `notificar-movimentacao`. WhatsApp (Z-API) e a aba "MOVIMENTAÇÕES APP" estão no código, mas **desligados** (sem secrets).
- **Agendamentos (pg_cron)**: sincronização do CRM (a cada 5 min), lembrete semanal aos dispatchers (segunda 8h) e aviso de pedido parado há mais de 24 h (de hora em hora). Backup semanal no Google Drive pelo Apps Script (domingo 3h).
- Dispatcher vê só os galpões dele (RLS + `pode_gerir_galpao`). Cadastro público desligado; usuários são criados pelo admin na tela Equipe (`admin-criar-usuario`).

## Publicar

- Banco: `npx supabase db push --linked --yes` (depois da confirmação).
- Funções: `npx supabase functions deploy <nome> --project-ref idihrzbchxaptjgvsjfu --use-api --no-verify-jwt`. Todas usam `verify_jwt = false`, porque o projeto assina JWT com ES256; a autenticação é feita dentro de cada função.
- Site: `npx vercel deploy --prod --yes`, ou automático se o repositório estiver ligado à Vercel.

## Documentação

- `docs/TESTES_SEGURANCA.md`: roteiro de testes manuais (desatualizado em relação a pedidos agrupados, várias placas, notificações, painel e relatório).
- `docs/PLANILHA_SHEETS.md`: integração com a planilha e backup.
- `docs/NOTIFICACOES.md`: notificações push.
- `docs/AVISOS_WHATSAPP.md`: Z-API e aba de movimentações (opcional).
