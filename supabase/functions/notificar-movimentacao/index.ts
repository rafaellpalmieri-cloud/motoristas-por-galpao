// Chamada pelos gatilhos do banco (pg_net):
//  { historico_id }  → inativação/reativação:
//      • notificação push para os dispatchers ativos do galpão (menos quem fez);
//      • WhatsApp (Z-API), só se configurado;
//      • mudanças feitas NO APP: linha na aba "MOVIMENTAÇÕES APP" (se configurado).
//  { solicitacao_id, status } → pedido de inativação:
//      • "pendente": push para os admins ativos;
//      • "aprovada"/"recusada": push para quem pediu.
//
// Autenticação: cabeçalho "x-webhook-token" igual ao secret NOTIFICAR_TOKEN.
// Secrets: NOTIFICAR_TOKEN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
//          (opcionais: ZAPI_INSTANCE_ID, ZAPI_TOKEN, ZAPI_CLIENT_TOKEN, PLANILHA_WEBAPP_URL, PLANILHA_SYNC_TOKEN)
// Nenhuma notificação leva CPF.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const SITE = 'https://motoristas-por-galpao.vercel.app'

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

function dataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

interface MotoristaResumo {
  codigo: string
  nome_completo: string | null
  placa: string | null
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
  motoristas: MotoristaResumo | null
}

interface Pedido {
  id: number
  motorista_id: string
  galpao: string | null
  motivo: string
  status: string
  solicitado_por: string | null
  solicitado_por_nome: string | null
  decidido_por_nome: string | null
  resposta: string | null
  motoristas: MotoristaResumo | null
}

interface Aviso {
  title: string
  body: string
  url: string
  tag: string
}

function nomeMotorista(m: MotoristaResumo | null): string {
  const nome = m?.nome_completo || m?.codigo || 'Motorista'
  return m?.placa ? `${nome} (${m.placa})` : nome
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

  const esperado = Deno.env.get('NOTIFICAR_TOKEN') ?? ''
  if (esperado.length < 32) return json({ erro: 'Função mal configurada.' }, 500)
  if (!tokensIguais(req.headers.get('x-webhook-token') ?? '', esperado)) return json({ erro: 'Não autorizado.' }, 401)

  const corpo = await req.json().catch(() => null)
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  if (corpo?.solicitacao_id) return await tratarPedido(admin, Number(corpo.solicitacao_id), String(corpo.status ?? ''))
  if (corpo?.historico_id) return await tratarMovimento(admin, Number(corpo.historico_id))
  return json({ erro: 'Corpo inválido.' }, 400)
})

// ---------------------------------------------------------------------
// Inativação / reativação
// ---------------------------------------------------------------------
async function tratarMovimento(admin: SupabaseClient, historicoId: number): Promise<Response> {
  if (!Number.isInteger(historicoId) || historicoId <= 0) return json({ erro: 'historico_id inválido.' }, 400)

  const { data: trava, error: erroTrava } = await admin
    .from('movimentacoes_notificadas')
    .upsert({ historico_id: historicoId }, { onConflict: 'historico_id', ignoreDuplicates: true })
    .select('historico_id')
  if (erroTrava) return json({ erro: 'Falha ao registrar.' }, 500)
  if (!trava?.length) return json({ ok: true, ja_processado: true })

  const { data: mov } = await admin
    .from('motorista_historico')
    .select('*, motoristas(codigo, nome_completo, placa)')
    .eq('id', historicoId)
    .maybeSingle<Movimento>()
  if (!mov) return json({ erro: 'Movimentação não encontrada.' }, 404)

  const destinatarios = await dispatchersDoGalpao(admin, mov.galpao, mov.alterado_por)
  const inativo = mov.status_novo === 'inativo'
  const aviso: Aviso = {
    title: inativo ? `🚫 Inativado · ${mov.galpao ?? 'sem galpão'}` : `✅ Reativado · ${mov.galpao ?? 'sem galpão'}`,
    body: [
      nomeMotorista(mov.motoristas),
      inativo && mov.motivo ? `Motivo: ${mov.motivo}` : null,
      `Por ${mov.origem === 'planilha' ? 'planilha interna' : (mov.alterado_por_nome ?? 'usuário do app')} · ${dataHora(mov.alterado_em)}`,
    ]
      .filter(Boolean)
      .join('\n'),
    url: `/motoristas/${mov.motorista_id}`,
    tag: `mov-${mov.id}`,
  }

  const push = await enviarPush(admin, destinatarios.map((d) => d.user_id), aviso)
  const whatsapp = await enviarWhatsApp(destinatarios.map((d) => d.telefone), `*${aviso.title}*\n${aviso.body}\n\n${SITE}`)
  const planilha = mov.origem === 'app' ? await registrarNaPlanilha(mov) : { pulado: 'mudança veio da planilha' }

  await admin
    .from('movimentacoes_notificadas')
    .update({ whatsapp: { push, whatsapp }, planilha })
    .eq('historico_id', historicoId)
  return json({ ok: true, push, whatsapp, planilha })
}

// ---------------------------------------------------------------------
// Pedido de inativação
// ---------------------------------------------------------------------
async function tratarPedido(admin: SupabaseClient, id: number, status: string): Promise<Response> {
  if (!Number.isInteger(id) || id <= 0 || !['pendente', 'aprovada', 'recusada'].includes(status)) {
    return json({ erro: 'Pedido inválido.' }, 400)
  }

  const { data: trava, error: erroTrava } = await admin
    .from('solicitacoes_notificadas')
    .upsert({ solicitacao_id: id, status }, { onConflict: 'solicitacao_id,status', ignoreDuplicates: true })
    .select('solicitacao_id')
  if (erroTrava) return json({ erro: 'Falha ao registrar.' }, 500)
  if (!trava?.length) return json({ ok: true, ja_processado: true })

  const { data: pedido } = await admin
    .from('solicitacoes_inativacao')
    .select('*, motoristas(codigo, nome_completo, placa)')
    .eq('id', id)
    .maybeSingle<Pedido>()
  if (!pedido) return json({ erro: 'Pedido não encontrado.' }, 404)

  let usuarios: string[] = []
  let aviso: Aviso
  if (status === 'pendente') {
    usuarios = await adminsAtivos(admin)
    aviso = {
      title: `📝 Pedido de inativação · ${pedido.galpao ?? 'sem galpão'}`,
      body: `${nomeMotorista(pedido.motoristas)}\nMotivo: ${pedido.motivo}\nPor ${pedido.solicitado_por_nome ?? 'dispatcher'}`,
      url: '/pendencias',
      tag: `pedido-${pedido.id}`,
    }
  } else {
    usuarios = pedido.solicitado_por ? [pedido.solicitado_por] : []
    const aprovado = status === 'aprovada'
    aviso = {
      title: aprovado ? '✅ Pedido aprovado' : '↩️ Pedido recusado',
      body: [
        nomeMotorista(pedido.motoristas),
        aprovado ? 'Motorista inativado.' : 'O motorista continua ativo.',
        pedido.resposta ? `“${pedido.resposta}”` : null,
        pedido.decidido_por_nome ? `Por ${pedido.decidido_por_nome}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      url: `/motoristas/${pedido.motorista_id}`,
      tag: `pedido-${pedido.id}`,
    }
  }

  const push = await enviarPush(admin, usuarios, aviso)
  await admin
    .from('solicitacoes_notificadas')
    .update({ resultado: push })
    .eq('solicitacao_id', id)
    .eq('status', status)
  return json({ ok: true, push })
}

// ---------------------------------------------------------------------
// Destinatários
// ---------------------------------------------------------------------
async function dispatchersDoGalpao(
  admin: SupabaseClient,
  galpao: string | null,
  excluir: string | null,
): Promise<{ user_id: string; telefone: string | null }[]> {
  if (!galpao) return []
  const { data: vinculos } = await admin.from('dispatcher_galpoes').select('user_id').eq('galpao', galpao)
  const ids = (vinculos ?? []).map((v) => v.user_id as string).filter((id) => id !== excluir)
  if (!ids.length) return []
  const [{ data: perfis }, { data: papeis }] = await Promise.all([
    admin.from('perfis').select('user_id, telefone').in('user_id', ids).eq('ativo', true),
    admin.from('user_roles').select('user_id').in('user_id', ids).eq('role', 'dispatcher'),
  ])
  const ehDispatcher = new Set((papeis ?? []).map((p) => p.user_id as string))
  return (perfis ?? []).filter((p) => ehDispatcher.has(p.user_id as string)) as { user_id: string; telefone: string | null }[]
}

async function adminsAtivos(admin: SupabaseClient): Promise<string[]> {
  const { data: papeis } = await admin.from('user_roles').select('user_id').eq('role', 'admin')
  const ids = (papeis ?? []).map((p) => p.user_id as string)
  if (!ids.length) return []
  const { data: perfis } = await admin.from('perfis').select('user_id').in('user_id', ids).eq('ativo', true)
  return (perfis ?? []).map((p) => p.user_id as string)
}

// ---------------------------------------------------------------------
// Envio push (Web Push / VAPID)
// ---------------------------------------------------------------------
async function enviarPush(admin: SupabaseClient, usuarios: string[], aviso: Aviso) {
  const publica = Deno.env.get('VAPID_PUBLIC_KEY')
  const privada = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!publica || !privada) return { pulado: 'VAPID não configurado' }
  if (!usuarios.length) return { enviados: 0, motivo: 'sem destinatários' }

  const { data: inscricoes } = await admin
    .from('push_inscricoes')
    .select('id, endpoint, p256dh, auth')
    .in('user_id', usuarios)
  if (!inscricoes?.length) return { enviados: 0, motivo: 'nenhum aparelho com notificação ativada' }

  webpush.setVapidDetails(SITE, publica, privada)
  const carga = JSON.stringify(aviso)
  let enviados = 0
  const removidos: number[] = []
  const falhas: string[] = []
  await Promise.all(
    inscricoes.map(async (i) => {
      try {
        await webpush.sendNotification({ endpoint: i.endpoint, keys: { p256dh: i.p256dh, auth: i.auth } }, carga, {
          TTL: 6 * 3600,
          urgency: 'high',
        })
        enviados++
      } catch (e) {
        const codigo = (e as { statusCode?: number }).statusCode
        // 404/410: o aparelho cancelou a inscrição — remove.
        if (codigo === 404 || codigo === 410) removidos.push(i.id)
        else falhas.push(String(codigo ?? (e as Error).message))
      }
    }),
  )
  if (removidos.length) await admin.from('push_inscricoes').delete().in('id', removidos)
  return { enviados, removidos: removidos.length, falhas }
}

// ---------------------------------------------------------------------
// WhatsApp (Z-API) — opcional, só se configurado
// ---------------------------------------------------------------------
async function enviarWhatsApp(telefones: (string | null)[], mensagem: string) {
  const instancia = Deno.env.get('ZAPI_INSTANCE_ID')
  const token = Deno.env.get('ZAPI_TOKEN')
  const clientToken = Deno.env.get('ZAPI_CLIENT_TOKEN')
  if (!instancia || !token) return { pulado: 'Z-API não configurada' }
  const numeros = [
    ...new Set(
      telefones
        .map((t) => (t ?? '').replace(/\D/g, ''))
        .map((d) => (d.length === 10 || d.length === 11 ? `55${d}` : d.length >= 12 && d.length <= 13 ? d : ''))
        .filter(Boolean),
    ),
  ]
  let enviados = 0
  for (const phone of numeros) {
    const r = await fetch(`https://api.z-api.io/instances/${instancia}/token/${token}/send-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(clientToken ? { 'Client-Token': clientToken } : {}) },
      body: JSON.stringify({ phone, message: mensagem }),
    }).catch(() => null)
    if (r?.ok) enviados++
  }
  return { enviados }
}

// ---------------------------------------------------------------------
// Aba "MOVIMENTAÇÕES APP" — opcional, só se configurada
// ---------------------------------------------------------------------
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
