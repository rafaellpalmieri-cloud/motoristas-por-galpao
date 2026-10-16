# Testes de segurança: passo a passo

Este guia repete pelo celular as mesmas verificações que o script automático faz. Use **apenas dados fictícios**: o arquivo `docs/exemplo_motoristas_ficticios.csv` e as contas de teste abaixo.

Tempo estimado: uns 30 minutos. Você vai precisar de:
- o celular (para o dispatcher) e um computador ou uma segunda janela anônima (para o admin);
- sua conta de **admin** já criada (README, seção 5).

---

## 0. Teste automático (no computador)

Rode os dois. Ambos devem terminar com `=== TODOS OS TESTES PASSARAM ===`.

1. Local, sem tocar em servidor:
   ```bash
   npm run test:rls
   ```
2. No projeto Supabase: abra o **SQL Editor**, cole o conteúdo de `supabase/tests/rls_seguranca.sql` e clique em **Run**. As linhas `OK: ...` aparecem nas mensagens. O script termina em `ROLLBACK`, então nada fica gravado.

O que ele verifica: anon não lê nada; o dispatcher do SRJ1 não lê nem altera motorista do SRJ2; ele também não lê motoristas sem galpão nem `user_roles` de outros; UPDATE, DELETE e INSERT diretos em `motoristas` não funcionam; inativar sem motivo falha; `importar_motoristas` chamado por dispatcher falha; reimportar o mesmo CSV não sobrescreve o status; dispatcher desativado não vê nada.

---

## 1. Contas de teste

Use apelidos do seu próprio e-mail (no Gmail, `+qualquercoisa` cai na mesma caixa):

| Conta | E-mail sugerido | Galpões |
|---|---|---|
| Dispatcher SRJ1 | `seuemail+srj1@gmail.com` | SRJ1 |
| Dispatcher SRJ2 | `seuemail+srj2@gmail.com` | SRJ2 |

Como admin, vá em **Equipe → + Novo** e crie as duas contas. Para cada uma:

- [ ] A senha temporária aparece **uma vez**, com o botão Copiar. Anote.
- [ ] Ao fechar a janela, a senha não aparece mais em lugar nenhum.
- [ ] Na lista da Equipe, a conta aparece com o selo **SENHA PENDENTE**.
- [ ] Criar de novo com o mesmo e-mail mostra "Já existe um usuário com esse e-mail".

## 2. Importar o CSV fictício (admin)

Na aba **CSV → Escolher arquivo**, selecione `docs/exemplo_motoristas_ficticios.csv`.

- [ ] A pré-visualização mostra **11 linhas, 8 válidas, 3 com erro**.
- [ ] Os erros listados são: linha 10 (`codigo é obrigatório`), linha 11 (`galpão inválido: SRJ99`), linha 12 (`status inválido: "talvez"`).
- [ ] O galpão ` srj 4 ` aparece normalizado como `SRJ4`.
- [ ] Clique em **Importar 8 linha(s)**. O relatório final mostra **8 novos, 0 atualizados, 3 erros**.
- [ ] No **Painel**: SRJ1 com 2 ativos e 1 inativo, SRJ2 com 2 ativos, SRJ4 com 1, HUB com 1, e o card **Sem galpão** com 1.

## 3. Primeiro acesso do dispatcher SRJ1 (celular)

Abra o app no celular e entre com `seuemail+srj1@...` e a senha temporária.

- [ ] O app **obriga a trocar a senha** antes de mostrar qualquer coisa.
- [ ] Senha curta, sem números ou com confirmação diferente é recusada com mensagem clara.
- [ ] Depois da troca, a lista mostra **só** os motoristas do SRJ1 (FAKE-1001, 1002 e 1003).
- [ ] Não aparecem FAKE-1004 e 1005 (SRJ2), FAKE-1006 (SRJ4) nem FAKE-1008 (sem galpão).
- [ ] As abas Painel, Equipe e CSV não aparecem.
- [ ] Digitar na barra de endereço `.../admin/importar` volta para a lista.
- [ ] Os contadores mostram **2 ativos, 1 inativo**.
- [ ] A busca por `tst1a02` encontra o Bruno, e a busca por `carla` encontra a Carla.
- [ ] Os botões 📞 e WhatsApp abrem o discador e o WhatsApp com +55.
- [ ] (Opcional) **Adicionar à tela inicial**: o ícone aparece e o app abre em tela cheia.

## 4. Inativar e reativar (dispatcher SRJ1)

No card da **Ana (FAKE-1001)**, toque em **Inativar**.

- [ ] Sem escolher motivo, tocar **Inativar** mostra "Escolha o motivo." e nada muda.
- [ ] Com motivo **Outro** e observação vazia, aparece "Descreva o motivo na observação."
- [ ] Escolha **Parou de rodar** e confirme. O card fica inativo na hora e aparece a mensagem de sucesso.
- [ ] O card mostra "Inativado em DD/MM · Parou de rodar".
- [ ] Toque no nome para abrir o **detalhe**: o histórico mostra Ativo → Inativo, o motivo, o seu nome e a data e hora.
- [ ] Toque em **Reativar** e confirme. O histórico ganha uma nova linha Inativo → Ativo.
- [ ] **Erro de rede:** ligue o modo avião, tente inativar o Bruno e confirme. O card volta ao estado anterior e aparece uma mensagem de erro. Desligue o modo avião.

Deixe a **Ana inativada** para os próximos passos (inative de novo com "Parou de rodar").

## 5. Isolamento entre galpões (dispatcher SRJ2)

Numa janela anônima ou noutro aparelho, entre com `seuemail+srj2@...` e troque a senha.

- [ ] A lista mostra só FAKE-1004 e FAKE-1005.
- [ ] Na conta SRJ1, abra o detalhe da Ana e copie o endereço da página (`.../motoristas/<id>`). Abra esse endereço na conta SRJ2: deve aparecer **"Motorista não encontrado"**, sem nome, celular nem histórico.
- [ ] O sino 🔔 do SRJ2 **não** mostra a inativação da Ana, porque ela é do SRJ1.

## 6. Alertas de inativação (admin)

- [ ] Na conta admin, o sino 🔔 mostra um número (as inativações feitas pelo SRJ1).
- [ ] Ao abrir **Alertas**, a Ana aparece em destaque **Novo**, com motivo, galpão, autor e "há X min".
- [ ] Ao voltar para a lista, o número do sino zera. Na lista de motoristas, a Ana tem o selo **Novo** até você abrir os alertas.

## 7. Reimportar não sobrescreve o status (admin)

Importe **o mesmo** `exemplo_motoristas_ficticios.csv` de novo.

- [ ] O relatório mostra **0 novos, 8 atualizados, 3 erros**.
- [ ] A **Ana continua inativa**, mesmo com o CSV dizendo `ativo`.
- [ ] A **Carla (FAKE-1003)** continua inativa, com a data original.

## 8. Gestão da equipe (admin)

- [ ] **Galpões:** em Equipe, no dispatcher SRJ2, toque em **Galpões** e acrescente SRJ1. Na conta SRJ2, puxe a lista para atualizar (ou reabra o app): agora aparecem os motoristas de SRJ1 e SRJ2 e o filtro por galpão. Depois volte a deixar só o SRJ2.
- [ ] **Nova senha:** gere uma nova senha para o SRJ2. A senha antiga deixa de funcionar, a temporária funciona e o app obriga a troca de novo.
- [ ] **Desativar:** desative o SRJ2. Na conta SRJ2, ao atualizar, os dados somem e aparece "Acesso não liberado". Tentar entrar de novo mostra "Sua conta está desativada".
- [ ] **Reativar:** reative e confirme que o login volta a funcionar.
- [ ] Na sua própria conta de admin não aparecem os botões de desativar.

## 9. Esqueci minha senha

- [ ] Na tela de login, toque em **Esqueci minha senha** e informe `seuemail+srj1@...`.
- [ ] O e-mail chega. O link abre a tela **Nova senha**, você define a senha e entra no app.
- [ ] Usar o mesmo link uma segunda vez mostra "Link inválido ou expirado".

> Se o link abrir `localhost`, ajuste a **Site URL** e as **Redirect URLs** (README, seção 8).

## 10. Exportar (admin)

- [ ] Em **CSV → Baixar CSV**, abra o arquivo no Excel e no Google Sheets. Os acentos aparecem certos (ex.: "Saiu da operação").
- [ ] As colunas `ultima_alteracao_em` e `ultima_alteracao_por` aparecem preenchidas para a Ana.

## 11. Papel anon (no computador, opcional)

Troque `REF` e `ANON` pelos valores do seu projeto (a chave anon é pública).

```bash
curl -s "https://REF.supabase.co/rest/v1/motoristas?select=*" -H "apikey: ANON" -H "Authorization: Bearer ANON"
```

- [ ] A resposta é um erro `permission denied` (código `42501`), sem nenhum dado.

## 12. Limpeza

Depois dos testes, no **SQL Editor**:

```sql
delete from public.motoristas where codigo like 'FAKE-%';
```

E em *Authentication → Users*, apague as contas `+srj1` e `+srj2`. Perfil, papel e galpões são apagados junto.

---

### Registro

| Data | Quem testou | Passos OK | Problemas encontrados |
|---|---|---|---|
| | | | |
