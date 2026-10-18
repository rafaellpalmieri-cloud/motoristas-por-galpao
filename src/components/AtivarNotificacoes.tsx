import { useEffect, useState } from 'react'
import { mensagemErro } from '../lib/erros'
import { ativarPush, desativarPush, estadoPush, type EstadoPush } from '../lib/push'
import { useToast } from './Toast'
import { Botao } from './ui'

const CHAVE_DISPENSADO = 'notificacoes-banner-dispensado'

function useEstadoPush() {
  const [estado, setEstado] = useState<EstadoPush | null>(null)
  useEffect(() => {
    let vivo = true
    estadoPush()
      .then((e) => vivo && setEstado(e))
      .catch(() => vivo && setEstado('sem-suporte'))
    return () => {
      vivo = false
    }
  }, [])
  return [estado, setEstado] as const
}

/** Cartão completo (tela de Alertas): ativar, desativar e instruções. */
export function CartaoNotificacoes() {
  const [estado, setEstado] = useEstadoPush()
  const [carregando, setCarregando] = useState(false)
  const toast = useToast()

  async function ativar() {
    setCarregando(true)
    try {
      const novo = await ativarPush()
      setEstado(novo)
      if (novo === 'ativado') toast('Notificações ativadas neste aparelho.', 'sucesso')
    } catch (e) {
      toast(`Não foi possível ativar: ${mensagemErro(e)}`, 'erro')
    } finally {
      setCarregando(false)
    }
  }

  async function desativar() {
    setCarregando(true)
    try {
      await desativarPush()
      setEstado('desativado')
      toast('Notificações desativadas neste aparelho.', 'info')
    } finally {
      setCarregando(false)
    }
  }

  if (!estado) return null

  return (
    <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
      <p className="font-semibold text-sky-900">🔔 Notificações neste aparelho</p>
      {estado === 'ativado' && (
        <>
          <p className="mt-1 text-sm text-sky-900">
            Ativadas. Você recebe um aviso quando um motorista dos seus galpões for inativado ou reativado, e quando houver
            resposta aos seus pedidos.
          </p>
          <Botao variante="secundario" className="mt-3" carregando={carregando} onClick={desativar}>
            Desativar neste aparelho
          </Botao>
        </>
      )}
      {estado === 'desativado' && (
        <>
          <p className="mt-1 text-sm text-sky-900">
            Receba um aviso no celular ou no computador, mesmo com o site fechado, quando houver inativações nos seus
            galpões.
          </p>
          <Botao className="mt-3" carregando={carregando} onClick={ativar}>
            Ativar notificações
          </Botao>
        </>
      )}
      {estado === 'precisa-instalar' && (
        <p className="mt-1 text-sm text-sky-900">
          No iPhone, primeiro adicione o site à tela inicial: toque em <strong>Compartilhar</strong> (□↑) →{' '}
          <strong>Adicionar à Tela de Início</strong>. Depois abra pelo ícone e ative aqui.
        </p>
      )}
      {estado === 'bloqueado' && (
        <p className="mt-1 text-sm text-sky-900">
          As notificações estão bloqueadas para este site. Libere nas configurações do navegador (cadeado ao lado do
          endereço → Notificações → Permitir) e recarregue a página.
        </p>
      )}
      {estado === 'sem-suporte' && (
        <p className="mt-1 text-sm text-sky-900">
          Este navegador não aceita notificações. Use o Chrome, Edge ou Firefox (ou, no iPhone, o site adicionado à tela
          inicial).
        </p>
      )}
    </div>
  )
}

/** Faixa discreta no topo, só enquanto as notificações não foram ativadas. */
export function FaixaNotificacoes() {
  const [estado, setEstado] = useEstadoPush()
  const [dispensado, setDispensado] = useState(() => {
    try {
      return localStorage.getItem(CHAVE_DISPENSADO) === '1'
    } catch {
      return false
    }
  })
  const toast = useToast()

  if (dispensado || (estado !== 'desativado' && estado !== 'precisa-instalar')) return null

  function dispensar() {
    setDispensado(true)
    try {
      localStorage.setItem(CHAVE_DISPENSADO, '1')
    } catch {
      /* sem armazenamento: só esconde nesta visita */
    }
  }

  return (
    <div className="border-b border-sky-200 bg-sky-50">
      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 py-2 text-sm text-sky-900">
        <span className="flex-1">
          {estado === 'precisa-instalar'
            ? 'Adicione o site à tela inicial para receber avisos de inativação.'
            : 'Receba avisos de inativação no celular ou computador.'}
        </span>
        {estado === 'desativado' && (
          <button
            type="button"
            className="min-h-11 rounded-xl bg-sky-700 px-3 font-semibold text-white"
            onClick={async () => {
              try {
                const novo = await ativarPush()
                setEstado(novo)
                if (novo === 'ativado') toast('Notificações ativadas neste aparelho.', 'sucesso')
              } catch (e) {
                toast(`Não foi possível ativar: ${mensagemErro(e)}`, 'erro')
              }
            }}
          >
            Ativar
          </button>
        )}
        <button type="button" aria-label="Dispensar" className="min-h-11 min-w-11 rounded-xl text-lg" onClick={dispensar}>
          ×
        </button>
      </div>
    </div>
  )
}
