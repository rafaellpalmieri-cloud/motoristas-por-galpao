// Recebe do Apps Script da planilha interna:
//  - acao "inativos" (padrão): linhas da aba INATIVOS → inativa quem ainda está ativo (gera alerta);
//  - acao "ativos": linhas da aba ATIVOS → cadastra novos e atualiza dados (nunca muda status);
//  - acao "buscar_codigos": { linha, placa, celular } → devolve o código do app (preenchimento único);
//  - acao "backup": devolve motoristas, histórico, pedidos e equipe (cópia semanal no Google Drive).
//
// Autenticação: cabeçalho "x-sync-token" igual ao secret PLANILHA_SYNC_TOKEN.
// (Apps Script não tem JWT do Supabase, por isso verify_jwt = false.)
//
// Só os campos das listas abaixo são repassados ao banco. Qualquer outro
// (RG, endereço...) é descartado aqui, mesmo que venha por engano.
// CPF e dados de rota só são aceitos na aba ATIVOS (cadastro do motorista).
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const CAMPOS_BASE = ['linha', 'codigo', 'nome_completo', 'celular', 'placa', 'galpao', 'modal', 'data', 'motivo']
const CAMPOS_ATIVOS = [...CAMPOS_BASE, 'cpf', 'realizou_rotas', 'qtd_rotas', 'ultima_rota']

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
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ erro: 'Função mal configurada.' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  if (corpo.acao === 'backup') return json(await gerarBackup(admin))

  const acao = (corpo.acao ?? 'inativos') as keyof typeof FUNCOES
  if (!(acao in FUNCOES)) return json({ erro: 'Ação inválida.' }, 400)
  if (!Array.isArray(corpo.linhas)) return json({ erro: 'Esperado { "linhas": [...] }.' }, 400)
  if (corpo.linhas.length > 1000) return json({ erro: 'Máximo de 1000 linhas por envio.' }, 400)

  const linhas = corpo.linhas.map((bruta) => {
    const l = (bruta ?? {}) as Record<string, unknown>
    const limpa: Record<string, string> = {}
    for (const c of acao === 'ativos' ? CAMPOS_ATIVOS : CAMPOS_BASE) {
      const v = l[c]
      if (v !== undefined && v !== null) limpa[c] = String(v).slice(0, 200)
    }
    return limpa
  })

  const { data, error } = await admin.rpc(FUNCOES[acao], { p_linhas: linhas })
  if (error) {
    console.error(error)
    return json({ erro: 'Falha ao sincronizar.' }, 500)
  }
  return json(data)
})

/** Lê uma tabela inteira em páginas de 1000 linhas. */
async function lerTudo(admin: SupabaseClient, tabela: string, colunas: string, ordem: string) {
  const linhas: Record<string, unknown>[] = []
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin.from(tabela).select(colunas).order(ordem).range(de, de + 999)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    linhas.push(...((data ?? []) as unknown as Record<string, unknown>[]))
    if (!data || data.length < 1000) return linhas
  }
}

async function gerarBackup(admin: SupabaseClient) {
  try {
    const [motoristas, historico, pedidos, equipe] = await Promise.all([
      lerTudo(
        admin,
        'motoristas',
        'codigo, nome_completo, cpf, celular, placa, modal, galpao, status, inativo_desde, motivo_inativacao, realizou_rotas, qtd_rotas, ultima_rota, atualizado_em',
        'codigo',
      ),
      lerTudo(
        admin,
        'motorista_historico',
        'id, motorista_id, galpao, status_anterior, status_novo, motivo, observacao, alterado_por_nome, alterado_em, origem',
        'id',
      ),
      lerTudo(
        admin,
        'solicitacoes_inativacao',
        'id, grupo, motorista_id, galpao, motivo, observacao, status, solicitado_por_nome, solicitado_em, decidido_por_nome, decidido_em, resposta',
        'id',
      ),
      lerTudo(admin, 'perfis', 'nome, email, telefone, ativo, criado_em, ultimo_acesso', 'nome'),
    ])
    return { gerado_em: new Date().toISOString(), motoristas, historico, pedidos, equipe }
  } catch (e) {
    console.error(e)
    return { erro: (e as Error).message }
  }
}
