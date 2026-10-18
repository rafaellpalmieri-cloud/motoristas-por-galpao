import { supabase } from './supabase'

// Chave PÚBLICA do VAPID (pode ficar no código). A privada fica só como
// secret da Edge Function notificar-movimentacao.
const CHAVE_PUBLICA_VAPID =
  'BDqrEZOlc6RdadIsgrvltxFu4xXw4OtZvDdq_6WAnDQIHo1JS5UNoGwTapCWtqjpg8yVhLoIovkOslcZw8N8AVg'

export type EstadoPush = 'sem-suporte' | 'precisa-instalar' | 'bloqueado' | 'desativado' | 'ativado'

function base64ParaBytes(base64: string): Uint8Array<ArrayBuffer> {
  const preenchido = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const binario = atob(preenchido)
  const bytes = new Uint8Array(new ArrayBuffer(binario.length))
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i)
  return bytes
}

/** iPhone/iPad só recebem push com o site adicionado à tela inicial. */
export function ehIosForaDaTelaInicial(): boolean {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const instalado =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return ios && !instalado
}

export function registrarServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('Service worker não registrado:', e))
  }
}

export async function estadoPush(): Promise<EstadoPush> {
  if (ehIosForaDaTelaInicial()) return 'precisa-instalar'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'sem-suporte'
  if (Notification.permission === 'denied') return 'bloqueado'
  const registro = await navigator.serviceWorker.getRegistration()
  const inscricao = await registro?.pushManager.getSubscription()
  return inscricao && Notification.permission === 'granted' ? 'ativado' : 'desativado'
}

export async function ativarPush(): Promise<EstadoPush> {
  const permissao = await Notification.requestPermission()
  if (permissao !== 'granted') return permissao === 'denied' ? 'bloqueado' : 'desativado'

  const registro = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const inscricao =
    (await registro.pushManager.getSubscription()) ??
    (await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ParaBytes(CHAVE_PUBLICA_VAPID),
    }))

  const dados = inscricao.toJSON()
  const { error } = await supabase.rpc('registrar_push', {
    p_endpoint: inscricao.endpoint,
    p_p256dh: dados.keys?.p256dh ?? '',
    p_auth: dados.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  })
  if (error) throw error
  return 'ativado'
}

/** Desliga as notificações deste aparelho (também usado ao sair da conta). */
export async function desativarPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const registro = await navigator.serviceWorker.getRegistration()
  const inscricao = await registro?.pushManager.getSubscription()
  if (!inscricao) return
  await supabase.rpc('remover_push', { p_endpoint: inscricao.endpoint })
  await inscricao.unsubscribe()
}
