# Notificações do site (celular e computador)

O site manda avisos pelo próprio navegador (Web Push), sem WhatsApp e sem custo.

| Quem recebe | Quando |
|---|---|
| **Dispatchers do galpão** (menos quem fez a mudança) | motorista **inativado** ou **reativado**, no app ou pela planilha (só mudanças recentes, das últimas 2 horas) |
| **Admins** | chegou um **pedido de inativação** |
| **Quem fez o pedido** | o pedido foi **aprovado** ou **recusado** |

Tocar no aviso abre o motorista, ou a tela de Pendências. As notificações não levam CPF.

## Como cada pessoa ativa

1. Entre no site e abra **Alertas** (🔔). Também aparece uma faixa azul no topo, com o botão **Ativar**.
2. Toque em **Ativar notificações** e permita quando o navegador perguntar.
3. Isso vale **por aparelho**: quem usa celular e computador ativa nos dois.

| Aparelho | Funciona? |
|---|---|
| Android (Chrome) | ✅ direto pelo navegador |
| Computador (Chrome, Edge, Firefox) | ✅ com o navegador aberto, mesmo com a aba do site fechada |
| iPhone/iPad (iOS 16.4+) | ✅ só com o site **adicionado à tela inicial** (Compartilhar → Adicionar à Tela de Início), abrindo pelo ícone |

- **Bloqueei sem querer:** clique no cadeado ao lado do endereço → Notificações → Permitir, e recarregue a página.
- **Sair da conta** desliga as notificações daquele aparelho.

## Como funciona por dentro

```
Mudança no banco (histórico / pedido) ──gatilho + pg_net──▶ Edge Function notificar-movimentacao ──Web Push──▶ aparelhos
```

- `push_inscricoes`: um registro por aparelho. Cada pessoa só vê e remove os próprios; a gravação passa pela função `registrar_push`.
- Chaves VAPID: a **pública** está em `src/lib/push.ts`; a **privada** fica só como secret da função (`VAPID_PRIVATE_KEY`), gerada no arquivo `supabase/.vapid_private`, que está fora do git.
- O gatilho só chama a função se existirem os segredos `notificar_url` e `notificar_token` no Vault. Para desligar tudo, apague `notificar_token` em *Project Settings → Vault*.
- Aparelho que cancelou a inscrição (resposta 404/410) é removido automaticamente.
- O WhatsApp (Z-API) e a aba "MOVIMENTAÇÕES APP" continuam no código, desligados. Só funcionam se forem configurados ([AVISOS_WHATSAPP.md](AVISOS_WHATSAPP.md)).
