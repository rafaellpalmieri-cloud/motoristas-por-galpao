// Lê os cadastros direto do CRM (Supabase da empresa, projeto "Loogirio") e
// manda para sincronizar_base_crm, a mesma regra que a aba BASE - SUPABASE usava.
// Chamada pelo pg_cron a cada 5 minutos (disparar_sincronizacao_crm, migração 0027).
//
// Acesso ao CRM: usuário de banco "app_frota_leitura", que só lê a visão
// app_frota.motoristas (docs/crm/leitura-app-frota.sql). Nunca a service_role do CRM.
// As rotas NÃO vêm daqui: continuam pela aba BASE - POWER BI (ação "rotas" da
// função sincronizar-planilha), e sincronizar_base_crm não mexe em rotas sem qtd_rotas.
//
// Autenticação: cabeçalho "x-webhook-token" igual ao secret NOTIFICAR_TOKEN.
// Secrets: NOTIFICAR_TOKEN, CRM_DB_URL (connection string do pooler, usuário app_frota_leitura).
import { createClient } from 'npm:@supabase/supabase-js@2'
import postgres from 'npm:postgres@3.4.5'

const LOTE = 1000

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

function texto(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString()
  return String(v).trim().slice(0, 200)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

  const esperado = Deno.env.get('NOTIFICAR_TOKEN') ?? ''
  if (esperado.length < 32) return json({ erro: 'Função mal configurada.' }, 500)
  if (!tokensIguais(req.headers.get('x-webhook-token') ?? '', esperado)) return json({ erro: 'Não autorizado.' }, 401)

  const crmUrl = Deno.env.get('CRM_DB_URL')
  if (!crmUrl) return json({ pulado: 'CRM_DB_URL não configurado.' })

  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) return json({ erro: 'Função mal configurada.' }, 500)
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  // Só as colunas da visão; o CPF vai só com dígitos, como o Apps Script fazia.
  const crm = postgres(crmUrl, { ssl: 'require', max: 1, prepare: false, idle_timeout: 5, connect_timeout: 15 })
  let cadastros: Record<string, unknown>[]
  try {
    cadastros = await crm`
      select id::text as id, status, nome_completo, cpf, celular, galpao, tipo_veiculo, placa,
             id_coopmetro, encerramento_motivo, updated_at
      from app_frota.motoristas
      order by id`
  } catch (e) {
    console.error('Leitura do CRM:', (e as Error).message)
    return json({ erro: 'Falha ao ler o CRM.' }, 502)
  } finally {
    await crm.end({ timeout: 5 })
  }

  const linhas = cadastros
    .filter((c) => texto(c.id))
    .map((c, i) => {
      const cpf = texto(c.cpf).replace(/\D/g, '')
      return {
        linha: String(i + 1),
        crm_id: texto(c.id),
        status: texto(c.status),
        nome_completo: texto(c.nome_completo),
        cpf: cpf.length >= 9 && cpf.length <= 11 ? cpf.padStart(11, '0') : '',
        celular: texto(c.celular),
        galpao: texto(c.galpao),
        modal: texto(c.tipo_veiculo),
        placa: texto(c.placa),
        id_coopmetro: texto(c.id_coopmetro),
        encerramento_motivo: texto(c.encerramento_motivo),
        atualizado_crm: texto(c.updated_at),
      }
    })

  const total = { lidos: linhas.length, novos: 0, atualizados: 0, inativados: 0, reativados: 0, ignorados: 0, erros: [] as unknown[] }
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { data, error } = await admin.rpc('sincronizar_base_crm', { p_linhas: linhas.slice(i, i + LOTE) })
    if (error) {
      console.error(error)
      return json({ erro: 'Falha ao sincronizar.' }, 500)
    }
    const r = data as Record<string, number | unknown[]>
    for (const k of ['novos', 'atualizados', 'inativados', 'reativados', 'ignorados'] as const) {
      total[k] += Number(r[k] ?? 0)
    }
    total.erros.push(...((r.erros as unknown[]) ?? []))
  }
  if (total.erros.length) console.error('Erros na sincronização do CRM:', JSON.stringify(total.erros.slice(0, 10)))
  return json({ ...total, erros: total.erros.length })
})
