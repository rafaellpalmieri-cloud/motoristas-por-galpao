# Integração com a planilha interna (Google Sheets)

A planilha **RELAÇÃO INTERNA ATIVOS E INATIVOS** é a fonte dos motoristas. Desde 28/10/2026 o app lê a aba **BASE - SUPABASE**, uma exportação do CRM de cadastros sem fórmulas, a cada 15 minutos. As rotas vêm da aba **BASE - POWER BI**. As abas ATIVOS e INATIVOS **não são mais usadas**.

```
BASE - SUPABASE + BASE - POWER BI ──Apps Script, a cada 15 min──▶ Edge Function sincronizar-planilha (ação "base") ──▶ banco do app
```

| Status no CRM | No app |
|---|---|
| `ativo` | ativo |
| `inativo`, `pausado` | inativo (pausado aparece assim) |
| qualquer outro (cancelado, em análise...) | não entra; quem já está no app e passa a outro status é inativado |

## Regras importantes

- **O `id` do CRM identifica cada cadastro** (cada placa). Ordenar ou filtrar a aba não troca ninguém de lugar.
- **Código exibido no app = ID Coopmetro.** Quem ainda não tem ID Coopmetro aparece com um código provisório `CRM-XXXXXXXX`, trocado sozinho quando o ID Coopmetro aparecer. Se dois cadastros tiverem o mesmo ID Coopmetro, o segundo ganha um sufixo.
- **O CRM manda no status, mas só quando ele muda.** O app guarda o último status visto no CRM. Inativou ou reativou no CRM: o app acompanha, grava no histórico com o selo **Planilha** e fecha os pedidos pendentes que perderam o sentido. Se o status do CRM não mudou, a sincronização não desfaz uma inativação ou reativação feita no app.
- **Rotas:** para cada CPF, o script soma a maior contagem de "Rotas Meli" e de "Rotas Shopee" da aba BASE - POWER BI e usa a data mais recente de "Última Rota". Sem CPF correspondente, o app fica sem dados de rota para aquele cadastro.
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

## Backup semanal no Google Drive

O mesmo script faz uma cópia de segurança toda semana, aos domingos às 3h. O agendamento é criado pelo `instalarGatilho`.

- Pasta no seu Drive: **"Backups - Motoristas por Galpão"**, com uma subpasta por data.
- Arquivos CSV: `motoristas` (com CPF), `historico`, `pedidos` e `equipe`.
- Ficam os **12 backups mais recentes**; os mais antigos vão para a lixeira do Drive.
- Para fazer um backup na hora, execute **`fazerBackup`**.
- Ao rodar pela primeira vez, o Google pede permissão para o script usar o **Google Drive**. Aceite.
- **Não compartilhe essa pasta:** ela tem os CPFs.

## No dia a dia

Tudo é feito no CRM; a aba BASE - SUPABASE se atualiza a partir dele e o app acompanha em até 15 minutos.

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
