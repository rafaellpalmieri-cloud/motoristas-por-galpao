# Integração com a planilha interna (Google Sheets)

A planilha **RELAÇÃO INTERNA ATIVOS E INATIVOS** é a fonte dos motoristas. A cada 15 minutos o app lê as duas abas:

| Aba | O que acontece no app |
|---|---|
| **ATIVOS** | motorista com **código novo** é cadastrado como ativo; quem já existe tem nome, celular, placa, modal e galpão atualizados. **O status de quem já existe nunca muda** (uma inativação feita no app continua valendo). |
| **INATIVOS** | motorista que ainda está ativo no app é **inativado**, com a data e o motivo da planilha, e gera um **alerta** no sino com o selo **Planilha** para os dispatchers do galpão. |

```
Planilha ──Apps Script, a cada 15 min──▶ Edge Function sincronizar-planilha ──▶ banco do app
           1º ATIVOS (novos/dados)        2º INATIVOS (inativações)
```

## Regras importantes

- **RG e endereço nunca saem da planilha.** O script lê coluna por coluna e só as permitidas: código, nome, celular, placa, galpão, modal, data e motivo, e, **só da aba ATIVOS**, CPF, "Realizou rotas", "Qntd rotas" e "Ultima Rota". A Edge Function descarta qualquer outro campo, e o CPF de linhas da aba INATIVOS.
- **O código é o que identifica o motorista.** Na aba ATIVOS, só linhas **com código** são enviadas. Na aba INATIVOS, o app procura pelo código; se não houver código, procura pela placa e depois pelo celular.
- **Cada linha da aba INATIVOS é aplicada uma única vez.** Se um dispatcher reativar o motorista no app, a mesma linha não o inativa de novo.
- **Inativações antigas não disparam alerta de "novo".** O histórico usa a data da planilha.
- **Voltar um motorista para a aba ATIVOS não o reativa no app.** A reativação é feita por um dispatcher, no app, para evitar que planilha e app fiquem "brigando" a cada 15 minutos.
- O app **não escreve na planilha**. A única exceção é a função `preencherCodigos`, que você roda uma vez.
- A importação por CSV continua funcionando, com as mesmas regras.

## Configuração (uns 5 minutos)

O token da sincronização fica no arquivo `supabase/.planilha_sync_token`, que está fora do git. Ele já está cadastrado como secret no Supabase.

1. Abra a planilha → **Extensões → Apps Script**.
2. Apague todo o conteúdo do editor e cole o arquivo [`docs/apps-script/sincronizar-planilha.gs`](apps-script/sincronizar-planilha.gs). Salve (💾).
3. **Token** (se ainda não fez): clique em ⚙️ **Configurações do projeto** → **Propriedades do script** → **Adicionar propriedade do script**.
   - Propriedade: `PLANILHA_SYNC_TOKEN`
   - Valor: o conteúdo do arquivo `supabase/.planilha_sync_token`
4. **Preencher os códigos (uma vez):** no editor, escolha a função **`preencherCodigos`** e clique em **Executar**.
   - Ela cria a coluna **`codigo`** no fim das abas ATIVOS e INATIVOS, se ainda não existir, e preenche cada linha vazia com o código que o motorista já tem no app, buscando pela placa e depois pelo celular.
   - Códigos já preenchidos não são alterados.
   - O registro mostra quantos foram preenchidos e lista as linhas que precisam ser preenchidas à mão (motorista não encontrado no app, ou placa repetida).
5. **Sincronizar:** escolha **`sincronizarTudo`** e clique em **Executar**. O registro mostra `ATIVOS: {...}` e `INATIVOS: {...}`.
6. **Automático:** escolha **`instalarGatilho`** e clique em **Executar**. Isso troca o gatilho antigo pelo novo, que roda `sincronizarTudo` a cada 15 minutos. Para conferir: ⏰ **Acionadores**.

Se o Google pedir autorização de novo (o script agora também escreve na coluna de código), escolha sua conta → **Avançado → Acessar (não seguro)** → **Permitir**.

## No dia a dia

- **Motorista novo:** cadastre na aba ATIVOS **com o código** preenchido. Em até 15 minutos ele aparece no app como ativo.
- **Inativar:** mova a linha para a aba INATIVOS (de preferência com a data e o motivo). Em até 15 minutos ele fica inativo no app, e os dispatchers do galpão recebem o alerta.
- **Mudou celular, placa ou galpão:** altere na aba ATIVOS; o app atualiza em até 15 minutos.

## Colunas reconhecidas

O script encontra as colunas pelo **nome do cabeçalho**, sem diferenciar maiúsculas e acentos:

| Campo | Nomes aceitos |
|---|---|
| código | `codigo`, `cod`, `codigo_motorista` |
| placa | `placa` |
| celular | `celular`, `telefone`, `whatsapp` |
| nome | `nome_completo`, `nome`, `motorista` |
| galpão | `galpao` |
| modal | `modal` |
| data da inativação (INATIVOS) | `data_inativacao`, `data de inativação`, `inativo_desde`, `data_saida`, `data_desligamento`, `data` |
| motivo (INATIVOS) | `motivo`, `motivo_inativacao`, `motivo da inativação` |
| CPF (ATIVOS) | `cpf` (zeros à esquerda perdidos pela planilha são completados) |
| fez rota (ATIVOS) | `realizou_rotas`, `Realizou rotas` (SIM/NÃO) |
| quantidade de rotas (ATIVOS) | `Qntd rotas`, `qtd_rotas`, `quantidade_rotas` |
| última rota (ATIVOS) | `Ultima Rota`, `data_ultima_rota` |

## Problemas comuns

| Mensagem no registro | O que fazer |
|---|---|
| `Defina PLANILHA_SYNC_TOKEN…` | passo 3 |
| `Falha ao enviar … (401)` | o token do script é diferente do secret do Supabase; copie de novo do arquivo |
| `Aba "…" não encontrada` | o nome da aba mudou; ajuste `CONFIG.ABA_ATIVOS` ou `CONFIG.ABA_INATIVOS` no script |
| `Aba ATIVOS sem coluna "codigo"` | rode `preencherCodigos` |
| `ATIVOS: {… "sem_codigo": N}` | há N linhas sem código na aba ATIVOS; elas não são enviadas até receberem um código |
| `galpão inválido` | o galpão da linha não é um dos 10 galpões; corrija na planilha |

## Trocar o token (se vazar)

```bash
npx supabase secrets set PLANILHA_SYNC_TOKEN=NOVO_TOKEN_COM_32_CARACTERES_OU_MAIS --project-ref idihrzbchxaptjgvsjfu
```

Depois atualize a propriedade `PLANILHA_SYNC_TOKEN` no Apps Script.
