// Roda as migrações e os testes de segurança num Postgres embutido (PGlite),
// sem Docker e sem tocar em nenhum projeto Supabase.
// Uso: npm run test:rls
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = fileURLToPath(new URL('..', import.meta.url))
const pastaMigracoes = join(raiz, 'supabase', 'migrations')
const arquivoTeste = join(raiz, 'supabase', 'tests', 'rls_seguranca.sql')

// Simula o mínimo do ambiente Supabase: papéis, schema auth e auth.uid().
const ambienteSupabase = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- Privilégios padrão que o Supabase concede em public:
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`

const db = new PGlite()
let falhou = false
try {
  await db.exec(ambienteSupabase)
  for (const arquivo of readdirSync(pastaMigracoes).filter((f) => f.endsWith('.sql')).sort()) {
    console.log(`Migração: ${arquivo}`)
    await db.exec(readFileSync(join(pastaMigracoes, arquivo), 'utf8'))
  }
  console.log('\nTestes de segurança:')
  await db.exec(readFileSync(arquivoTeste, 'utf8'), {
    onNotice: (n) => console.log(`  ${n.message}`),
  })
} catch (erro) {
  falhou = true
  console.error(`\n${erro.message}`)
} finally {
  await db.close()
}
process.exit(falhou ? 1 : 0)
