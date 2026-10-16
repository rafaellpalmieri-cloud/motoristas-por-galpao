# Motoristas por Galpão

App web (pensado para celular) para os dispatchers dos galpões **SRJ1, SRJ2, SRJ4, SRJ5, SRJ8, SRJ9, SRJ10, SRJ13, SRJ17 e HUB** marcarem motoristas como **ativos** ou **inativos**.

- **Dispatcher:** vê só os motoristas dos seus galpões, busca por nome ou placa, liga ou chama no WhatsApp, inativa (com motivo) e reativa, e vê o histórico.
- **Admin:** tudo isso e mais painel por galpão, gestão da equipe, importação e exportação de CSV, e motoristas sem galpão.
- **Alertas de inativação:** o sino 🔔 no topo mostra quantos motoristas outras pessoas inativaram desde a sua última visita. A tela **Alertas** lista as inativações dos últimos 30 dias, com quem fez, quando, o motivo e o galpão. Na lista, inativações recentes ganham o selo **Novo**. Cada um só vê alertas dos próprios galpões.

- **Integração com a planilha interna (Google Sheets):** a cada 15 minutos, motoristas novos da aba ATIVOS são cadastrados (pelo código) e os movidos para a aba INATIVOS são inativados no app, gerando alerta com o selo **Planilha**. CPF e outros dados sensíveis nunca saem da planilha. Configuração em [`docs/PLANILHA_SHEETS.md`](docs/PLANILHA_SHEETS.md).

- **Avisos de movimentação:** cada inativação ou reativação manda WhatsApp (Z-API) para os dispatchers do galpão. As feitas no app também viram uma linha na aba **MOVIMENTAÇÕES APP** da planilha. Configuração em [`docs/AVISOS_WHATSAPP.md`](docs/AVISOS_WHATSAPP.md).

Stack: Vite + React + TypeScript, Tailwind CSS, React Router, TanStack Query, supabase-js, Papa Parse. Backend: Supabase (Postgres + RLS, Auth, Edge Functions).

> ⚠️ Este app usa um **projeto Supabase novo e exclusivo**. Nunca aponte para o Supabase de produção da empresa.

---

## 1. Pré-requisitos

- Node.js 20 ou superior (`node --version`)
- Uma conta em <https://supabase.com>
- A Supabase CLI já vem como dependência do projeto: use sempre `npx supabase ...`. Não precisa instalar nada além disso, e Docker é dispensável.

## 2. Criar o projeto Supabase

1. Em <https://supabase.com/dashboard>, clique em **New project**.
   - Nome: `motoristas-por-galpao`
   - Região: **South America (São Paulo)**
   - Anote a senha do banco num gerenciador de senhas.
2. Anote o **project-ref**, o código que aparece na URL do painel: `https://supabase.com/dashboard/project/<project-ref>`.
3. **Desligue o cadastro público:** *Authentication → Sign In / Providers → "Allow new users to sign up"* → **desligado**.
4. **URLs de redirecionamento** (usadas pelo "Esqueci minha senha"): em *Authentication → URL Configuration*:
   - **Site URL:** `http://localhost:5173` por enquanto. Depois da publicação, troque pelo domínio final.
   - **Redirect URLs:** adicione `http://localhost:5173/redefinir-senha` e, depois, `https://SEU-DOMINIO/redefinir-senha`.
5. Em *Project Settings → API*, copie a **Project URL** e a chave **anon / publishable**. São as únicas que o frontend usa.
   **Não copie a `service_role` / secret para lugar nenhum.**

## 3. Aplicar as migrações

Todo o SQL fica em `supabase/migrations/`. Não altere o banco pelo painel.

```bash
npx supabase login
```

```bash
npx supabase link --project-ref SEU_PROJECT_REF
```

> Antes de rodar o `link`, confira que o project-ref é o do projeto **novo deste app**.

```bash
npx supabase db push
```

O que as migrações criam:

| Arquivo | Conteúdo |
|---|---|
| `..._tipos_e_tabelas.sql` | enum `app_role`, tabelas `perfis`, `user_roles`, `dispatcher_galpoes`, `motoristas`, `motorista_historico`, RLS ligada |
| `..._funcoes_permissao.sql` | `has_role`, `usuario_ativo`, `eh_admin`, `pode_gerir_galpao` |
| `..._funcoes_negocio.sql` | `alterar_status_motorista`, `importar_motoristas`, `exportar_motoristas`, `resumo_por_galpao`, `marcar_senha_trocada`, `marcar_alertas_vistos` |
| `..._rls_e_grants.sql` | políticas RLS; acesso de `anon` revogado |
| `..._indices.sql` | índices |

## 4. Edge Functions e secrets

```bash
npx supabase functions deploy admin-criar-usuario
```

```bash
npx supabase functions deploy admin-gerir-usuario
```

**Sobre a `service_role`:** o Supabase injeta automaticamente as secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` em toda Edge Function. Elas aparecem em *Edge Functions → Secrets*. Por isso você **não precisa digitar nem copiar a service_role em lugar nenhum**: ela fica só no servidor, dentro da função.

Opcional, mas recomendado depois de publicar o app: restringir a origem que pode chamar as funções.

```bash
npx supabase secrets set APP_ORIGIN=https://SEU-DOMINIO
```

| Função | Quem pode chamar | O que faz |
|---|---|---|
| `admin-criar-usuario` | admin (JWT + papel conferidos dentro da função) | cria o usuário (e-mail já confirmado) com senha temporária, perfil, papel `dispatcher` e galpões. Devolve a senha **uma única vez** |
| `admin-gerir-usuario` | admin | `redefinir_senha` (nova senha temporária e troca obrigatória), `desativar` (perfil inativo + login bloqueado), `reativar` |

## 5. Criar o primeiro admin

O app **não** tem "o primeiro que se cadastrar vira admin".

1. No painel: *Authentication → Users → Add user → Create new user*. Informe seu e-mail e uma senha forte e marque **Auto Confirm User**.
2. Abra `supabase/seed/primeiro_admin.sql` e troque `COLOQUE_SEU_EMAIL_AQUI@exemplo.com` e `Seu Nome`.
3. Cole o conteúdo no **SQL Editor** e clique em **Run**. A mensagem esperada é `Pronto: ... agora é admin.`

> Não faça commit do arquivo com seu e-mail: volte o placeholder depois de rodar.

## 6. Rodar localmente

```bash
npm install
```

Crie o arquivo `.env.local` (ele está no `.gitignore`) copiando o `.env.example`:

```
VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=sua-chave-anon
```

```bash
npm run dev
```

Acesse <http://localhost:5173>. Para testar no celular na mesma rede Wi-Fi, rode `npm run dev -- --host` e abra o IP que aparecer.

Outros comandos:

```bash
npm run lint
```

```bash
npm run build
```

## 7. Testes de segurança

```bash
npm run test:rls
```

Esse comando roda todas as migrações e os testes de `supabase/tests/rls_seguranca.sql` num Postgres embutido (PGlite), **sem Docker e sem tocar em nenhum projeto**. A saída esperada termina com `=== TODOS OS TESTES PASSARAM ===`.

O mesmo arquivo pode ser colado no **SQL Editor** do projeto: ele roda dentro de `BEGIN … ROLLBACK` e não deixa nada gravado.

O passo a passo para repetir os testes pelo celular, com contas de teste, está em [`docs/TESTES_SEGURANCA.md`](docs/TESTES_SEGURANCA.md).

## 8. Publicar

As duas plataformas abaixo funcionam. Em ambas, só existem **duas** variáveis de ambiente:

| Variável | Valor |
|---|---|
| `VITE_SUPABASE_URL` | `https://SEU_PROJECT_REF.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | chave anon / publishable |

### Vercel
1. Suba o repositório no GitHub (o `.gitignore` já impede o envio de `.env`).
2. Em <https://vercel.com/new>, importe o repositório. O framework **Vite** é detectado sozinho.
3. Em *Environment Variables*, adicione as duas variáveis acima e clique em **Deploy**.
4. O `vercel.json` já cuida das rotas do app (SPA).

### Netlify
1. Em <https://app.netlify.com>: *Add new site → Import an existing project*.
2. O build e a pasta vêm do `netlify.toml` (`npm run build` e `dist`).
3. Em *Site configuration → Environment variables*, adicione as duas variáveis e publique.

### Depois de publicar
- No Supabase, em *Authentication → URL Configuration*, troque a **Site URL** pelo domínio final e adicione `https://SEU-DOMINIO/redefinir-senha` às **Redirect URLs**.
- Opcional: `npx supabase secrets set APP_ORIGIN=https://SEU-DOMINIO`.
- No celular, abra o site e use **"Adicionar à tela inicial"**: o app abre como um aplicativo (PWA).

## 9. Formato do CSV de importação

Colunas (cabeçalho obrigatório, separador `,` ou `;`):

```
codigo,nome_completo,celular,placa,galpao,status,modal,inativo_desde
```

- `codigo`: obrigatório e único. É a chave da importação.
- `galpao`: um dos 10 galpões ou vazio (sem galpão). Maiúsculas e espaços são normalizados, então ` srj 1 ` vira `SRJ1`.
- `status`: `ativo` ou `inativo`.
- `inativo_desde`: `AAAA-MM-DD` ou `DD/MM/AAAA` (opcional).
- Motorista **novo** entra com o status do CSV. Motorista **existente** tem nome, celular, placa, modal e galpão atualizados, mas **status e inativo_desde nunca são sobrescritos** pela importação.
- O envio é feito em lotes de 500 linhas. No fim aparece um relatório com novos, atualizados e erros por linha.
- Há um arquivo de exemplo **fictício** em `docs/exemplo_motoristas_ficticios.csv`.

A exportação gera um CSV em UTF-8 com BOM e separador `;`, que abre direto no Excel em português e no Google Sheets.

## 10. Segurança, em resumo

- RLS ligada em todas as tabelas; o papel `anon` não tem acesso a nada.
- O dispatcher **não** consegue alterar motoristas diretamente: a mudança passa por `alterar_status_motorista`, que confere a permissão, trava a linha e grava o histórico na mesma transação.
- Os papéis ficam em `user_roles`, separados do perfil. Só o admin gerencia papéis e galpões.
- Usuário desativado perde o acesso aos dados na hora (pela RLS) e não consegue mais fazer login (bloqueio no Auth).
- O app não coleta nem guarda CPF, RG ou endereço.
- Não versione dados reais de motoristas: o CSV real é importado pela tela de admin.

## Estrutura

```
├── docs/                    TESTES_SEGURANCA.md, CSV de exemplo fictício
├── public/                  manifest PWA e ícones
├── scripts/testar-rls.mjs   roda migrações e testes no PGlite
├── src/
│   ├── auth/                sessão, perfil e guardas de rota
│   ├── components/          UI (botões, modal, card, layout, toast)
│   ├── hooks/               consultas e mutações (TanStack Query)
│   ├── lib/                 supabase, CSV, datas, telefone, constantes
│   └── pages/               telas (admin/ carrega sob demanda)
└── supabase/
    ├── config.toml          enable_signup = false
    ├── functions/           Edge Functions (Deno)
    ├── migrations/          todo o SQL versionado
    ├── seed/                primeiro_admin.sql e dados fictícios locais
    └── tests/               rls_seguranca.sql
```
