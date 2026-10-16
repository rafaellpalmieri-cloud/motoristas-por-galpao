// Chamada pelo gatilho do banco (pg_net) a cada inativação/reativação.
//  1. WhatsApp (Z-API) para os dispatchers ativos do galpão (menos quem fez a mudança).
//  2. Mudanças feitas NO APP: uma linha na aba "MOVIMENTAÇÕES APP" da planilha
//     (via Web App do Apps Script).
//
// Autenticação: cabeçalho "x-webhook-token" igual ao secret NOTIFICAR_TOKEN.
// Secrets usados (nenhum no código):
//   NOTIFICAR_TOKEN, ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN,
//   PLANILHA_WEBAPP_URL, PLANILHA_SYNC_TOKEN
// Sem as secrets da Z-API ou da planilha, aquela parte é apenas pulada.
import { createClient } from 'npm:@supabase/supabase-js@2'

function json(corpo: unknown, status = 200): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function tokensIguais(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let dif = 0
  for (let i = 0; i < ea.length; i++) dif |= ea[i] ^ eb[i]
  return dif === 0
}

function telefoneZapi(telefone: string | null): string | null {
  const d = (telefone ?? '').replace(/\D/g, '')
  if (d.length === 10 || d.length === 11) return `55${d}`
  if (d.length === 12 || d.length === 13) return d
  return null
}

function dataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

interface Movimento {
  id: number
  motorista_id: string
  galpao: string | null
  status_anterior: string | null
  status_novo: string
  motivo: string | null
  observacao: string | null
  alterado_por: string | null
  alterado_por_nome: string | null
  alterado_em: string
  origem: 'app' | 'planilha'
  motoristas: { codigo: string; nome_completo: string | null; placa: string | null } | null
}

function montarMensagem(m: Movimento): string {
  const inativo = m.status_novo === 'inativo'
  const nome = m.motoristas?.nome_completo || m.motoristas?.codigo || 'Motorista'
  const linhas = [
    inativo ? '🚫 *Motorista INATIVADO*' : '✅ *Motorista REATIVADO*',
    `${nome}${m.motoristas?.placa ? ` · ${m.motoristas.placa}` : ''}`,
    `Galpão: ${m.galpao ?? 'sem galpão'}`,
  ]
  if (inativo && m.motivo) linhas.push(`Motivo: ${m.motivo}`)
  if (m.observacao) linhas.push(`Obs.: ${m.observacao}`)
  linhas.push(
    `Por: ${m.origem === 'planilha' ? 'planilha interna' : (m.alterado_por_nome ?? 'usuário do app')} · ${dataHora(m.alterado_em)}`,
  )
  linhas.push('', 'Motoristas por Galpão — https://motoristas-por-galpao.vercel.app')
  return linhas.join('\n')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

  const esperado = Deno.env.get('NOTIFICAR_TOKEN') ?? ''
  if (esperado.length < 32) return json({ erro: 'Função mal configurada.' }, 500)
  if (!tokensIguais(req.headers.get('x-webhook-token') ?? '', esperado)) return json({ erro: 'Não autorizado.' }, 401)

  const corpo = await req.json().catch(() => null)
  const historicoId = Number(corpo?.historico_id)
  if (!Number.isInteger(historicoId) || historicoId <= 0) return json({ erro: 'historico_id inválido.' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Trava contra aviso duplicado (gatilho reenviado, chamada repetida etc.).
  const { data: trava, error: erroTrava } = await admin
    .from('movimentacoes_notificadas')
    .upsert({ historico_id: historicoId }, { onConflict: 'historico_id', ignoreDuplicates: true })
    .select('historico_id')
  if (erroTrava) {
    console.error(erroTrava)
    return json({ erro: 'Falha ao registrar.' }, 500)
  }
  if (!trava?.length) return json({ ok: true, ja_processado: true })

  const { data: mov, error: erroMov } = await admin
    .from('motorista_historico')
    .select('*, motoristas(codigo, nome_completo, placa)')
    .eq('id', historicoId)
    .maybeSingle<Movimento>()
  if (erroMov || !mov) return json({ erro: 'Movimentação não encontrada.' }, 404)

  const resultadoWhats = await enviarWhatsApp(admin, mov)
  const resultadoPlanilha = mov.origem === 'app' ? await registrarNaPlanilha(mov) : { pulado: 'mudança veio da planilha' }

  await admin
    .from('movimentacoes_notificadas')
    .update({ whatsapp: resultadoWhats, planilha: resultadoPlanilha })
    .eq('historico_id', historicoId)

  return json({ ok: true, whatsapp: resultadoWhats, planilha: resultadoPlanilha })
})

// deno-lint-ignore no-explicit-any
async function enviarWhatsApp(admin: any, mov: Movimento) {
  const instancia = Deno.env.get('ZAPI_INSTANCE_ID')
  const token = Deno.env.get('ZAPI_TOKEN')
  const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN')
  if (!instancia || !token) return { pulado: 'Z-API não configurada' }
  if (!mov.galpao) return { pulado: 'motorista sem galpão' }

  // Dispatchers ativos do galpão, com telefone.
  const { data: vinculos } = await admin.from('dispatcher_galpoes').select('user_id').eq('galpao', mov.galpao)
  const ids: string[] = (vinculos ?? []).map((v: { user_id: string }) => v.user_id).filter((id: string) => id !== mov.alterado_por)
  if (!ids.length) return { enviados: 0, motivo: 'nenhum dispatcher no galpão' }

  const [{ data: perfis }, { data: papeis }] = await Promise.all([
    admin.from('perfis').select('user_id, telefone').in('user_id', ids).eq('ativo', true),
    admin.from('user_roles').select('user_id').in('user_id', ids).eq('role', 'dispatcher'),
  ])
  const ehDispatcher = new Set((papeis ?? []).map((p: { user_id: string }) => p.user_id))
  const telefones = [
    ...new Set(
      (perfis ?? [])
        .filter((p: { user_id: string }) => ehDispatcher.has(p.user_id))
        .map((p: { telefone: string | null }) => telefoneZapi(p.telefone))
        .filter(Boolean) as string[],
    ),
  ]
  if (!telefones.length) return { enviados: 0, motivo: 'dispatchers sem telefone' }

  const mensagem = montarMensagem(mov)
  const url = `https://api.z-api.io/instances/${instancia}/token/${token}/send-text`
  let enviados = 0
  const falhas: string[] = []
  for (const phone of telefones) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(clientToken ? { 'Client-Token': clientToken } : {}) },
        body: JSON.stringify({ phone, message: mensagem }),
      })
      if (r.ok) enviados++
      else falhas.push(`${phone.slice(-4)}: HTTP ${r.status}`)
    } catch (e) {
      falhas.push(`${phone.slice(-4)}: ${(e as Error).message}`)
    }
  }
  // Só os 4 últimos dígitos vão para o registro.
  return { enviados, falhas }
}

async function registrarNaPlanilha(mov: Movimento) {
  const url = Deno.env.get('PLANILHA_WEBAPP_URL')
  const token = Deno.env.get('PLANILHA_SYNC_TOKEN')
  if (!url || !token) return { pulado: 'planilha não configurada' }
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        movimento: {
          data: dataHora(mov.alterado_em),
          codigo: mov.motoristas?.codigo ?? '',
          nome: mov.motoristas?.nome_completo ?? '',
          placa: mov.motoristas?.placa ?? '',
          galpao: mov.galpao ?? '',
          de: mov.status_anterior ?? '',
          para: mov.status_novo,
          motivo: mov.motivo ?? '',
          observacao: mov.observacao ?? '',
          por: mov.alterado_por_nome ?? '',
        },
      }),
    })
    const texto = await r.text()
    return { ok: r.ok && texto.includes('"ok":true'), status: r.status }
  } catch (e) {
    return { ok: false, erro: (e as Error).message }
  }
}
