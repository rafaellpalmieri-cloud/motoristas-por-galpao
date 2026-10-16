// Recebe do Apps Script da planilha interna:
//  - acao "inativos" (padrão): linhas da aba INATIVOS → inativa quem ainda está ativo (gera alerta);
//  - acao "ativos": linhas da aba ATIVOS → cadastra novos e atualiza dados (nunca muda status);
//  - acao "buscar_codigos": { linha, placa, celular } → devolve o código do app (preenchimento único).
//
// Autenticação: cabeçalho "x-sync-token" igual ao secret PLANILHA_SYNC_TOKEN.
// (Apps Script não tem JWT do Supabase, por isso verify_jwt = false.)
//
// Só os campos da lista abaixo são repassados ao banco. Qualquer outro
// (CPF, RG, endereço...) é descartado aqui, mesmo que venha por engano.
import { createClient } from 'npm:@supabase/supabase-js@2'

const CAMPOS = ['linha', 'codigo', 'nome_completo', 'celular', 'placa', 'galpao', 'modal', 'data', 'motivo'] as const

const FUNCOES = {
  inativos: 'sincronizar_inativos_planilha',
  ativos: 'sincronizar_ativos_planilha',
  buscar_codigos: 'buscar_codigos_planilha',
} as const

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/** Comparação em tempo constante, para não vazar o token por tempo de resposta. */
function tokensIguais(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let dif = 0
  for (let i = 0; i < ea.length; i++) dif |= ea[i] ^ eb[i]
  return dif === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

  const esperado = Deno.env.get('PLANILHA_SYNC_TOKEN') ?? ''
  const recebido = req.headers.get('x-sync-token') ?? ''
  if (esperado.length < 32) return json({ erro: 'Função mal configurada.' }, 500)
  if (!tokensIguais(recebido, esperado)) return json({ erro: 'Não autorizado.' }, 401)

  let corpo: { linhas?: unknown; acao?: unknown }
  try {
    corpo = await req.json()
  } catch {
    return json({ erro: 'JSON inválido.' }, 400)
  }
  const acao = (corpo.acao ?? 'inativos') as keyof typeof FUNCOES
  if (!(acao in FUNCOES)) return json({ erro: 'Ação inválida.' }, 400)
  if (!Array.isArray(corpo.linhas)) return json({ erro: 'Esperado { "linhas": [...] }.' }, 400)
  if (corpo.linhas.length > 1000) return json({ erro: 'Máximo de 1000 linhas por envio.' }, 400)

  const linhas = corpo.linhas.map((bruta) => {
    const l = (bruta ?? {}) as Record<string, unknown>
    const limpa: Record<string, string> = {}
    for (const c of CAMPOS) {
      const v = l[c]
      if (v !== undefined && v !== null) limpa[c] = String(v).slice(0, 200)
    }
    return limpa
  })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ erro: 'Função mal configurada.' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data, error } = await admin.rpc(FUNCOES[acao], { p_linhas: linhas })
  if (error) {
    console.error(error)
    return json({ erro: 'Falha ao sincronizar.' }, 500)
  }
  return json(data)
})
