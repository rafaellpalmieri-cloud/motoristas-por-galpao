# Integração com a planilha interna (Google Sheets)

A planilha **RELAÇÃO INTERNA ATIVOS E INATIVOS** continua sendo o lugar onde a equipe move o motorista da aba **ATIVOS** para a aba **INATIVOS**. O app lê a aba INATIVOS a cada 15 minutos e, para cada motorista que ainda está ativo no app:

- marca o motorista como **inativo**, com a data e o motivo da planilha (motivo fora da lista do app vira "Outro", e o texto original vai para a observação);
- grava no histórico com origem **Planilha**;
- mostra um **alerta** no sino 🔔 para os dispatchers daquele galpão e para os admins.

```
Planilha (aba INATIVOS) ──Apps Script, a cada 15 min──▶ Edge Function sincronizar-planilha ──▶ banco do app
```

## Regras importantes

- **CPF, RG e endereço nunca saem da planilha.** O script lê coluna por coluna e só as permitidas: nome, celular, placa, galpão, modal, data e motivo. A Edge Function também descarta qualquer outro campo.
- **Identificação do motorista:** pela **placa**; se a linha não tiver placa, pelo **celular** (últimos 11 dígitos).
- **Cada linha da planilha é aplicada uma única vez.** Se um dispatcher reativar o motorista no app, a mesma linha não o inativa de novo. Uma nova inativação na planilha, com outra data, vale normalmente.
- **Inativações antigas não disparam alerta de "novo".** O histórico usa a data da planilha; só as de hoje, ou sem data, contam como novas.
- **Motorista que não existe no app** é ignorado. Ele aparece no log do script como "não encontrado" e será aplicado se for importado depois.
- **Esta integração vai só da planilha para o app.** Reativar ou inativar no app não altera a planilha.

## Configuração (uma vez, uns 5 minutos)

O token da sincronização fica no arquivo `supabase/.planilha_sync_token`, que está fora do git. Ele já foi gerado e, depois da publicação, também está cadastrado como secret no Supabase.

1. Abra a planilha → **Extensões → Apps Script**.
2. Apague o conteúdo de `Código.gs` e cole todo o arquivo [`docs/apps-script/sincronizar-inativos.gs`](apps-script/sincronizar-inativos.gs). Salve (💾).
3. **Token:** clique em ⚙️ **Configurações do projeto** → **Propriedades do script** → **Adicionar propriedade do script**:
   - Propriedade: `PLANILHA_SYNC_TOKEN`
   - Valor: o conteúdo do arquivo `supabase/.planilha_sync_token` (abra no Bloco de Notas e copie)
   - Clique em **Salvar propriedades do script**.
4. **Primeiro envio:** volte ao editor (`< >`), escolha a função **`sincronizarInativos`** no menu de cima e clique em **Executar**.
   - O Google pede autorização: escolha sua conta → **Avançado → Acessar (não seguro)** → **Permitir**. O aviso aparece porque o script é seu e não foi publicado; é normal.
   - No **Registro de execução**, deve aparecer algo como `Sincronização: {"inativados":…,"nao_encontrados":…}`.
5. **Automático:** escolha a função **`instalarGatilho`** e clique em **Executar**. A partir daí, roda sozinho a cada 15 minutos. Para conferir: ⏰ **Acionadores**.

## Colunas reconhecidas na aba INATIVOS

O script encontra as colunas pelo **nome do cabeçalho**, sem diferenciar maiúsculas e acentos:

| Campo | Nomes aceitos |
|---|---|
| placa | `placa` |
| celular | `celular`, `telefone`, `whatsapp` |
| nome | `nome_completo`, `nome`, `motorista` |
| galpão | `galpao` |
| modal | `modal` |
| data da inativação | `data_inativacao`, `data de inativação`, `inativo_desde`, `data_saida`, `data_desligamento`, `data` |
| motivo | `motivo`, `motivo_inativacao`, `motivo da inativação` |

É obrigatório ter **placa** ou **celular**. Se a sua aba usa outro nome (por exemplo "DATA INATIVAÇÃO"), ele já é reconhecido; se for bem diferente, acrescente o nome na lista `COLUNAS` do script.

## Problemas comuns

| Mensagem no registro | O que fazer |
|---|---|
| `Defina PLANILHA_SYNC_TOKEN…` | passo 3 |
| `Falha ao enviar (401)` | o token do script é diferente do secret do Supabase; copie de novo do arquivo |
| `Aba "INATIVOS" não encontrada` | o nome da aba mudou; ajuste `CONFIG.ABA` no script |
| `nao_encontrados` alto | os motoristas ainda não foram importados no app, ou a placa está escrita diferente |

## Trocar o token (se vazar)

```bash
npx supabase secrets set PLANILHA_SYNC_TOKEN=NOVO_TOKEN_COM_32_CARACTERES_OU_MAIS --project-ref idihrzbchxaptjgvsjfu
```

Depois atualize a propriedade `PLANILHA_SYNC_TOKEN` no Apps Script.
