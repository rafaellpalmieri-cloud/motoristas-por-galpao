// Utilitários compartilhados das Edge Functions de administração.
// A service_role é injetada automaticamente pelo Supabase no ambiente da função
// (SUPABASE_SERVICE_ROLE_KEY). Ela nunca sai daqui nem vai para o frontend.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const GALPOES = ['SRJ1', 'SRJ2', 'SRJ4', 'SRJ5', 'SRJ8', 'SRJ9', 'SRJ10', 'SRJ13', 'SRJ17', 'HUB']

// APP_ORIGIN: domínio(s) do app, separados por vírgula
// (supabase secrets set APP_ORIGIN=https://seu-app.vercel.app).
// localhost também é aceito, para desenvolvimento. Sem APP_ORIGIN, aceita
// qualquer origem. A segurança de verdade é o JWT + papel admin conferidos aqui.
const origensPermitidas = (Deno.env.get('APP_ORIGIN') ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

function origemPermitida(origem: string | null): string {
  if (!origensPermitidas.length) return '*'
  if (origem && (origensPermitidas.includes(origem) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem))) {
    return origem
  }
  return origensPermitidas[0]
}

export const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
}

/** Envolve o handler: responde o preflight e põe CORS (com a origem certa) em toda resposta. */
export function comCors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const origem = origemPermitida(req.headers.get('Origin'))
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: { ...corsHeaders, 'Access-Control-Allow-Origin': origem } })
    }
    const resposta = await handler(req)
    resposta.headers.set('Access-Control-Allow-Origin', origem)
    for (const [k, v] of Object.entries(corsHeaders)) resposta.headers.set(k, v)
    return resposta
  }
}

export function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export class ErroHttp extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem)
  }
}

/**
 * Confere o JWT de quem chamou e se é admin ativo.
 * Devolve o cliente com service_role (só para uso dentro da função) e o id do admin.
 */
export async function exigirAdmin(req: Request): Promise<{ admin: SupabaseClient; adminId: string }> {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) throw new ErroHttp(500, 'Função mal configurada.')

  const authHeader = req.headers.get('Authorization') ?? ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) throw new ErroHttp(401, 'Não autenticado.')

  // Cliente no contexto do usuário: valida o token e consulta o papel pelo próprio banco.
  const usuario = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: dadosUser, error: erroUser } = await usuario.auth.getUser(token)
  if (erroUser || !dadosUser.user) throw new ErroHttp(401, 'Sessão inválida.')

  const { data: ehAdmin, error: erroPapel } = await usuario.rpc('eh_admin')
  if (erroPapel) throw new ErroHttp(500, 'Não foi possível verificar o papel.')
  if (ehAdmin !== true) throw new ErroHttp(403, 'Apenas administradores.')

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return { admin, adminId: dadosUser.user.id }
}

/** Senha temporária legível (sem 0/O, 1/l/I), 12 caracteres. */
export function gerarSenhaTemporaria(tamanho = 12): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(tamanho)
  crypto.getRandomValues(bytes)
  let senha = ''
  for (const b of bytes) senha += alfabeto[b % alfabeto.length]
  // Garante ao menos um dígito.
  return /\d/.test(senha) ? senha : senha.slice(0, -1) + '7'
}

export function validarGalpoes(valor: unknown): string[] {
  if (!Array.isArray(valor) || valor.length === 0) {
    throw new ErroHttp(400, 'Selecione ao menos um galpão.')
  }
  const lista = [...new Set(valor.map((g) => String(g).toUpperCase().replace(/\s/g, '')))]
  const invalidos = lista.filter((g) => !GALPOES.includes(g))
  if (invalidos.length) throw new ErroHttp(400, `Galpão inválido: ${invalidos.join(', ')}`)
  return lista
}

/** Telefone só com dígitos: DDD + número (10 ou 11), opcionalmente com 55 na frente. */
export function validarTelefone(valor: unknown, obrigatorio: boolean): string | null {
  const digitos = String(valor ?? '').replace(/\D/g, '')
  if (!digitos) {
    if (obrigatorio) throw new ErroHttp(400, 'Informe o telefone com DDD.')
    return null
  }
  if (digitos.length < 10 || digitos.length > 13) throw new ErroHttp(400, 'Telefone inválido. Use DDD + número.')
  return digitos
}

export function tratarErro(erro: unknown): Response {
  if (erro instanceof ErroHttp) return json({ erro: erro.message }, erro.status)
  console.error(erro)
  return json({ erro: 'Erro interno.' }, 500)
}
