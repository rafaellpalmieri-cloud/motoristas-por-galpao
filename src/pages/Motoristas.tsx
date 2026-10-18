import { useDeferredValue, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { CardMotorista } from '../components/CardMotorista'
import { ModalStatus } from '../components/ModalStatus'
import { Carregando, EstadoErro, EstadoVazio, Pagina } from '../components/ui'
import { useMotoristas } from '../hooks/motoristas'
import { usePendentes } from '../hooks/solicitacoes'
import { GALPOES, SEM_GALPAO } from '../lib/constantes'
import { mensagemErro } from '../lib/erros'
import type { Motorista } from '../lib/tipos'

type FiltroStatus = 'todos' | 'ativo' | 'inativo'
const POR_PAGINA = 60

function semAcento(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export default function Motoristas() {
  const { usuario, ehAdmin, session } = useAuth()
  const { data, isPending, error, refetch } = useMotoristas()
  const { data: pendentes } = usePendentes()
  const pendentePorMotorista = useMemo(() => new Map((pendentes ?? []).map((s) => [s.motorista_id, s])), [pendentes])
  const [params, setParams] = useSearchParams()
  const [selecionado, setSelecionado] = useState<Motorista | null>(null)
  const [limite, setLimite] = useState(POR_PAGINA)

  const busca = params.get('q') ?? ''
  const buscaAdiada = useDeferredValue(busca)
  const status = (params.get('status') as FiltroStatus) || 'todos'
  const galpao = params.get('galpao') ?? ''

  function definir(chave: string, valor: string) {
    setLimite(POR_PAGINA)
    setParams(
      (p) => {
        if (valor) p.set(chave, valor)
        else p.delete(chave)
        return p
      },
      { replace: true },
    )
  }

  const opcoesGalpao = ehAdmin ? [...GALPOES] : (usuario?.galpoes ?? [])
  const mostrarFiltroGalpao = ehAdmin || opcoesGalpao.length > 1
  const vistosEm = usuario?.perfil?.alertas_vistos_em

  const doGalpao = useMemo(() => {
    const lista = data ?? []
    if (!galpao) return lista
    if (galpao === SEM_GALPAO) return lista.filter((m) => m.galpao === null)
    return lista.filter((m) => m.galpao === galpao)
  }, [data, galpao])

  const contagem = useMemo(
    () => ({
      ativos: doGalpao.filter((m) => m.status === 'ativo').length,
      inativos: doGalpao.filter((m) => m.status === 'inativo').length,
    }),
    [doGalpao],
  )

  const filtrados = useMemo(() => {
    const termo = semAcento(buscaAdiada.trim())
    const termoPlaca = termo.replace(/[^a-z0-9]/g, '')
    return doGalpao.filter((m) => {
      if (status !== 'todos' && m.status !== status) return false
      if (!termo) return true
      return (
        semAcento(m.nome_completo ?? '').includes(termo) ||
        (!!termoPlaca && semAcento(m.placa ?? '').replace(/[^a-z0-9]/g, '').includes(termoPlaca))
      )
    })
  }, [doGalpao, buscaAdiada, status])

  function ehNovo(m: Motorista) {
    return (
      m.status === 'inativo' && !!vistosEm && m.atualizado_em > vistosEm && m.atualizado_por !== session?.user.id
    )
  }

  return (
    <Pagina titulo="Motoristas">
      <div className="sticky top-[57px] z-10 -mx-4 mb-3 flex flex-col gap-2 bg-slate-50/95 px-4 pb-2 pt-1 backdrop-blur">
        <input
          type="search"
          value={busca}
          onChange={(e) => definir('q', e.target.value)}
          placeholder="Buscar por nome ou placa"
          aria-label="Buscar por nome ou placa"
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
        />
        <div className="flex gap-2">
          <div role="group" aria-label="Filtrar por status" className="grid flex-1 grid-cols-3 rounded-xl border border-slate-300 bg-white p-1">
            {(
              [
                ['todos', 'Todos'],
                ['ativo', 'Ativos'],
                ['inativo', 'Inativos'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={status === valor}
                onClick={() => definir('status', valor === 'todos' ? '' : valor)}
                className={`min-h-10 rounded-lg text-sm font-semibold ${status === valor ? 'bg-sky-700 text-white' : 'text-slate-600'}`}
              >
                {rotulo}
              </button>
            ))}
          </div>
          {mostrarFiltroGalpao && (
            <select
              value={galpao}
              onChange={(e) => definir('galpao', e.target.value)}
              aria-label="Filtrar por galpão"
              className="min-h-12 rounded-xl border border-slate-300 bg-white px-2 text-sm font-medium"
            >
              <option value="">{ehAdmin ? 'Todos galpões' : 'Meus galpões'}</option>
              {opcoesGalpao.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
              {ehAdmin && <option value={SEM_GALPAO}>Sem galpão</option>}
            </select>
          )}
        </div>
        {data && (
          <div className="flex gap-2 text-sm">
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">{contagem.ativos} ativos</span>
            <span className="rounded-full bg-rose-50 px-3 py-1 font-semibold text-rose-700">{contagem.inativos} inativos</span>
          </div>
        )}
      </div>

      {isPending ? (
        <Carregando texto="Carregando motoristas…" />
      ) : error ? (
        <EstadoErro mensagem={mensagemErro(error)} aoTentarDeNovo={() => refetch()} />
      ) : data.length === 0 ? (
        <EstadoVazio titulo="Nenhum motorista por aqui">
          {ehAdmin ? 'Importe o CSV na aba CSV para começar.' : 'Ainda não há motoristas nos seus galpões.'}
        </EstadoVazio>
      ) : filtrados.length === 0 ? (
        <EstadoVazio titulo="Nenhum resultado">Tente outro nome, placa ou filtro.</EstadoVazio>
      ) : (
        <>
          <ul className="flex flex-col gap-3">
            {filtrados.slice(0, limite).map((m) => (
              <CardMotorista
                key={m.id}
                motorista={m}
                novo={ehNovo(m)}
                mostrarGalpao={mostrarFiltroGalpao}
                pendente={pendentePorMotorista.get(m.id)}
                aoAlterarStatus={setSelecionado}
              />
            ))}
          </ul>
          {filtrados.length > limite && (
            <button
              type="button"
              onClick={() => setLimite((l) => l + POR_PAGINA)}
              className="mt-4 min-h-12 w-full rounded-xl border border-slate-300 bg-white font-semibold text-sky-800"
            >
              Mostrar mais ({filtrados.length - limite} restantes)
            </button>
          )}
        </>
      )}

      <ModalStatus motorista={selecionado} aoFechar={() => setSelecionado(null)} />
    </Pagina>
  )
}
