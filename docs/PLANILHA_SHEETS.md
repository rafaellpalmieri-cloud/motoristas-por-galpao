# Integração com a planilha interna (Google Sheets)

> **Desde 30/10/2026 os motoristas vêm direto do CRM**, sem passar pela planilha. A planilha continua mandando só as **rotas** (aba BASE - POWER BI) e os treinamentos. Veja [Leitura direta do CRM](#leitura-direta-do-crm-desde-30102026) abaixo. As regras de status desta página continuam valendo.

```
CRM (Supabase "Loogirio", visão app_frota.motoristas) ──Edge Function sincronizar-crm, a cada 5 min (pg_cron)──▶ banco do app
BASE - POWER BI ──Apps Script, a cada 15 min──▶ Edge Function sincronizar-planilha (ação "rotas") ──▶ rotas por CPF
```

Antes disso, a aba **BASE - SUPABASE** (exportação do CRM) era lida pelo Apps Script (ação "base"). Essa função continua no script como reserva (`sincronizarBase`), para usar à mão se o acesso direto ao CRM sair do ar. As abas ATIVOS e INATIVOS **não são mais usadas**.

| Status no CRM | No app |
|---|---|
| `ativo` | ativo |
| `inativo`, `pausado` | inativo (pausado aparece assim) |
| qualquer outro (cancelado, em análise...) | não entra; quem já está no app e passa a outro status é inativado |

## Regras importantes

- **O `id` do CRM identifica cada cadastro** (cada placa). Ordenar ou filtrar a aba não troca ninguém de lugar.
- **Código exibido no app = ID Coopmetro.** Quem ainda não tem ID Coopmetro aparece com um código provisório `CRM-XXXXXXXX`, trocado sozinho quando o ID Coopmetro aparecer. Se dois cadastros tiverem o mesmo ID Coopmetro, o segundo ganha um sufixo.
- **O CRM manda no status, mas só quando ele muda.** O app guarda o último status visto no CRM. Inativou ou reativou no CRM: o app acompanha, grava no histórico com o selo **Planilha** e fecha os pedidos pendentes que perderam o sentido. Se o status do CRM não mudou, a sincronização não desfaz uma inativação ou reativação feita no app.
- **Rotas:** para cada CPF, o script soma a maior contagem de "Rotas Meli" e de "Rotas Shopee" da aba BASE - POWER BI e usa a data mais recente de "Última Rota". Sem CPF correspondente, o app fica sem dados de rota para aquele cadastro. Motoristas com o mesmo nome saem no Power BI com os CPFs juntos na mesma célula, uma linha por placa: o script separa os CPFs e pergunta ao app de quem é cada linha pela **placa** (o cadastro com aquela placa e um daqueles CPFs). Sem placa correspondente no app, a linha não vale para ninguém. A função `conferirHomonimos` lista essas linhas no registro.
- **Só estas colunas saem da planilha:** `id`, `status`, `nome_completo`, `cpf`, `celular`, `galpao`, `tipo_veiculo`, `placa`, `id_coopmetro`, `encerramento_motivo` e `updated_at` (BASE - SUPABASE), mais CPF, rotas e datas da BASE - POWER BI. **RG, endereço, filiação, renavam, chassi e o resto nunca são lidos.** A Edge Function também descarta qualquer outro campo.
- O app **não escreve na planilha**.
- A importação por CSV continua funcionando.

## Configuração (uns 5 minutos)

O token da sincronização fica no arquivo `supabase/.planilha_sync_token`, que está fora do git. Ele já está cadastrado como secret no Supabase.

1. Abra a planilha → **Extensões → Apps Script**.
2. Apague todo o conteúdo do editor e cole o arquivo [`docs/apps-script/sincronizar-planilha.gs`](apps-script/sincronizar-planilha.gs). Salve (💾).
3. **Token** (se ainda não fez): clique em ⚙️ **Configurações do projeto** → **Propriedades do script** → **Adicionar propriedade do script**.
   - Propriedade: `PLANILHA_SYNC_TOKEN`
   - Valor: o conteúdo do arquivo `supabase/.planilha_sync_token`
4. **Sincronizar:** escolha **`sincronizarTudo`** e clique em **Executar**. O registro mostra `BASE - SUPABASE: {...}` com novos, atualizados, inativados, reativados, ignorados e erros.
5. **Automático:** escolha **`instalarGatilho`** e clique em **Executar**. Isso troca o gatilho antigo pelo novo, que roda `sincronizarTudo` a cada 15 minutos. Para conferir: ⏰ **Acionadores**.

## Leitura direta do CRM (desde 30/10/2026)

- O CRM é o projeto Supabase **"Loogirio"** da empresa, tabela `cadastros`. O app **só lê**, por um usuário de banco próprio (`app_frota_leitura`) que enxerga **apenas** a visão `app_frota.motoristas`, com as mesmas colunas que a aba BASE - SUPABASE tinha. Nunca a chave `service_role` do CRM.
- A visão fica no schema `app_frota`, que não aparece na API do CRM. RG, endereço, filiação, renavam e chassi nem estão na visão.
- A Edge Function `sincronizar-crm` roda a cada 5 minutos (pg_cron `sincronizar-crm`) e usa a mesma regra de antes (`sincronizar_base_crm`). Ela não mexe em rotas.
- Secret: `CRM_DB_URL` (connection string do pooler do CRM com o usuário só-leitura), lido do arquivo `supabase/.crm_db_url`, fora do git.

**Ligar (uma vez):**
1. No painel do Supabase **Loogirio** → SQL Editor, cole e rode o arquivo `supabase/.crm_leitura.sql` (já tem a senha gerada; fica só no seu computador). O modelo sem senha está em [`docs/crm/leitura-app-frota.sql`](crm/leitura-app-frota.sql). No fim, a conferência deve listar só `app_frota.motoristas`.
2. Monte `supabase/.crm_db_url`: `postgresql://app_frota_leitura.<ref do CRM>:<senha>@<host do pooler>:5432/postgres` (host em **Connect → Session pooler** do projeto Loogirio).
3. Cadastre o secret: `npx supabase secrets set "CRM_DB_URL=$(cat supabase/.crm_db_url)" --project-ref idihrzbchxaptjgvsjfu`.
4. Depois que a primeira sincronização der certo, cole o Apps Script novo e rode `instalarGatilho` (ele passa a mandar só as rotas).

**Desligar:** no CRM, `drop owned by app_frota_leitura; drop role app_frota_leitura;`. No app, `select cron.unschedule('sincronizar-crm');` numa migração nova, e volte o Apps Script para `sincronizarBase`.

## Treinamentos (agendas dos galpões)

O mesmo script lê as agendas do Google Agenda de cada galpão a cada 15 minutos e manda ao app os eventos cujo título começa com **TREINAMENTO** (o formato que o `/marcar-treinamento` cria: `TREINAMENTO NOME DO MOTORISTA SRJx`). O telefone do motorista sai da descrição do evento. Descrição com **TESTE** é ignorada.

- Janela: de 7 dias atrás até 60 dias à frente.
- Remarcou na agenda: o app atualiza. Apagou o evento: o app marca como cancelado.
- Os dispatchers veem os treinamentos dos galpões deles na aba **Treinos** e, depois do horário, marcam **Compareceu** ou **Faltou**.

**Ligar (uma vez):** em ⚙️ **Configurações do projeto → Propriedades do script**, adicione a propriedade `AGENDAS_TREINAMENTO` com um JSON assim (um ID de agenda por galpão, os mesmos da skill `/marcar-treinamento`):

```json
{"SRJ1":"ID_DA_AGENDA@group.calendar.google.com","SRJ2":"...","SRJ8":"...","SRJ9":"...","SRJ10":"...","SRJ13":"..."}
```

Depois rode `sincronizarTudo` uma vez. O Google vai pedir permissão para o script ler o **Google Agenda**: aceite. Sem essa propriedade, a parte de treinamentos é pulada.

## Backup semanal no Google Drive

O mesmo script faz uma cópia de segurança toda semana, aos domingos às 3h. O agendamento é criado pelo `instalarGatilho`.

- Pasta no seu Drive: **"Backups - Motoristas por Galpão"**, com uma subpasta por data.
- Arquivos CSV: `motoristas` (com CPF), `historico`, `pedidos` e `equipe`.
- Ficam os **12 backups mais recentes**; os mais antigos vão para a lixeira do Drive.
- Para fazer um backup na hora, execute **`fazerBackup`**.
- Ao rodar pela primeira vez, o Google pede permissão para o script usar o **Google Drive**. Aceite.
- **Não compartilhe essa pasta:** ela tem os CPFs.

## No dia a dia

Tudo é feito no CRM; o app lê o CRM direto e acompanha em até 5 minutos. As rotas acompanham a aba BASE - POWER BI em até 15 minutos.

- **Motorista novo:** quando o cadastro fica ativo no CRM, ele entra no app como ativo.
- **Inativar ou pausar:** mude o status no CRM. O app inativa, grava no histórico e os dispatchers do galpão recebem o alerta.
- **Reativar:** volte o status para ativo no CRM.
- **Mudou celular, placa ou galpão:** altere no CRM.

## Problemas comuns

| Mensagem no registro | O que fazer |
|---|---|
| `Defina PLANILHA_SYNC_TOKEN…` | passo 3 |
| `Falha ao enviar … (401)` | o token do script é diferente do secret do Supabase; copie de novo do arquivo |
| `Aba "…" não encontrada` | o nome da aba mudou; ajuste `CONFIG.ABA_BASE` ou `CONFIG.ABA_ROTAS` no script |
| `Aba "…" sem a coluna "…"` | uma coluna foi renomeada ou removida na exportação do CRM; ajuste `COLUNAS_BASE` ou `COLUNAS_ROTAS` no script |
| `id do CRM inválido` | a célula `id` da linha não é um id do CRM |
| galpão em branco no app | o galpão do CRM não é um dos 10 galpões |

## Trocar o token (se vazar)

```bash
npx supabase secrets set PLANILHA_SYNC_TOKEN=NOVO_TOKEN_COM_32_CARACTERES_OU_MAIS --project-ref idihrzbchxaptjgvsjfu
```

Depois atualize a propriedade `PLANILHA_SYNC_TOKEN` no Apps Script.
