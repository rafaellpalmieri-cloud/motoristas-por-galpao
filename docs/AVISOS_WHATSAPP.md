# Avisos de movimentação: WhatsApp (Z-API) e aba "MOVIMENTAÇÕES APP"

Toda vez que um motorista é **inativado** ou **reativado**:

| | Mudança feita no app | Inativação vinda da planilha |
|---|---|---|
| **WhatsApp** para os dispatchers ativos do galpão (menos quem fez) | ✅ | ✅ |
| Linha na aba **MOVIMENTAÇÕES APP** da planilha | ✅ | — (a mudança já está na planilha) |

Exemplo de mensagem:

```
🚫 *Motorista INATIVADO*
NOME DO MOTORISTA · ABC1D23
Galpão: SRJ1
Motivo: Parou de rodar
Obs.: avisou que vai parar por 2 semanas
Por: Rafael Palmieri · 16/10/2026 14:30

Motoristas por Galpão — https://motoristas-por-galpao.vercel.app
```

```
Banco (gatilho no histórico) ──pg_net──▶ Edge Function notificar-movimentacao ──▶ Z-API (WhatsApp)
                                                                              └─▶ Apps Script (aba MOVIMENTAÇÕES APP)
```

## Regras

- O **telefone** usado é o cadastrado na tela **Equipe**. Dispatcher sem telefone não recebe aviso.
- Cada movimentação é avisada **uma única vez**.
- **Inativações antigas** trazidas da planilha, com data passada, **não geram aviso**: só as das últimas 2 horas.
- O aviso **nunca bloqueia** a mudança de status. Se a Z-API ou a planilha estiverem fora do ar, o status muda normalmente e o aviso é só perdido.
- A mensagem leva nome, placa, galpão, motivo e autor. **Nada de CPF.**
- A Z-API usa um WhatsApp comum, de forma não oficial. Use um número da empresa e mande avisos só para a equipe. Volume alto ou envio para desconhecidos aumenta o risco de bloqueio do número pelo WhatsApp.

## Configuração

### 1. Credenciais da Z-API (no seu computador)

1. Abra o arquivo `supabase/.env.zapi`, que fica fora do git.
2. Preencha os campos com os dados do painel da Z-API (*Instâncias → sua instância*):
   - `ZAPI_INSTANCE_ID`: ID da instância
   - `ZAPI_TOKEN`: token da instância
   - `ZAPI_CLIENT_TOKEN`: *Security Token* da conta (aba Segurança). Se você não usa, deixe vazio.
3. Salve. **Não cole esses valores no chat.**

### 2. Aba de movimentações (na planilha)

1. Em **Extensões → Apps Script**, cole a versão mais nova de [`docs/apps-script/sincronizar-planilha.gs`](apps-script/sincronizar-planilha.gs), substituindo tudo, e salve. O gatilho atual continua funcionando.
2. Clique em **Implantar → Nova implantação**.
   - Engrenagem ⚙️ ao lado de "Selecionar tipo" → **App da Web**
   - **Executar como:** Eu
   - **Quem pode acessar:** Qualquer pessoa. Isso é necessário para o servidor do app conseguir chamar o script; sem o token, o script recusa a chamada.
   - **Implantar** → autorize → copie a **URL do app da Web**, que termina em `/exec`.
3. Envie essa URL. Ela vira a secret `PLANILHA_WEBAPP_URL`.

> Se você alterar o script depois, use **Implantar → Gerenciar implantações → editar (lápis) → Versão: Nova versão**. Assim a URL continua a mesma.

### 3. Publicação (feita pelo Claude, com sua confirmação)

- `supabase secrets set --env-file supabase/.env.zapi`
- `supabase secrets set NOTIFICAR_TOKEN=… PLANILHA_WEBAPP_URL=…`
- Vault: segredos `notificar_url` e `notificar_token`, usados pelo gatilho
- `supabase db push` e `supabase functions deploy notificar-movimentacao`

## Conferir se está funcionando

1. Inative um motorista **de teste** pelo app.
2. Em poucos segundos:
   - os dispatchers do galpão recebem a mensagem no WhatsApp;
   - aparece uma linha nova na aba **MOVIMENTAÇÕES APP**.
3. Se nada chegar, o resultado de cada envio fica registrado na tabela `movimentacoes_notificadas` (colunas `whatsapp` e `planilha`). Peça ao Claude para consultar.

## Desligar os avisos

Apague o segredo `notificar_token` do Vault (*Project Settings → Vault*). O gatilho para de chamar a função.
