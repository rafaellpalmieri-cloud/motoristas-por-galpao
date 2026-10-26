import { useDeferredValue, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { CartaoSolicitacao } from '../components/CartaoSolicitacao'
import { Carregando, EstadoErro, EstadoVazio, Pagina } from '../components/ui'
import { agruparPedidos, useDecididas, usePendentes } from '../hooks/solicitacoes'
import { GALPOES } from '../lib/constantes'
import { mensagemErro } from '../lib/erros'
import type { Solicitacao } from '../lib/tipos'

function semAcento(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** Pedidos de inativação: admin aprova/recusa; dispatcher acompanha os do seu galpão. */
export default function Pendencias() {
  const { ehAdmin, usuario } = useAuth()
  const [aba, setAba] = useState<'pendentes' | 'decididas'>('pendentes')
  const [busca, setBusca] = useState('')
  const [galpao, setGalpao] = useState('')
  const buscaAdiada = useDeferredValue(busca)
  const pendentes = usePendentes()
  const decididas = useDecididas()
  const consulta = aba === 'pendentes' ? pendentes : decididas

  const opcoesGalpao = ehAdmin ? [...GALPOES] : (usuario?.galpoes ?? [])

  const filtradas = useMemo(() => {
    const termo = semAcento(buscaAdiada.trim())
    const termoPlaca = termo.replace(/[^a-z0-9]/g, '')
    return (consulta.data ?? []).filter((s: Solicitacao) => {
      if (galpao && s.galpao !== galpao) return false
      if (!termo) return true
      return (
        semAcento(s.motoristas?.nome_completo ?? '').includes(termo) ||
        (!!termoPlaca && semAcento(s.motoristas?.placa ?? '').replace(/[^a-z0-9]/g, '').includes(termoPlaca))
      )
    })
  }, [consulta.data, buscaAdiada, galpao])

  return (
    <Pagina titulo={ehAdmin ? 'Pendências' : 'Pedidos de inativação'}>
      <p className="mb-3 text-slate-600">
        {ehAdmin
          ? 'Pedidos dos dispatchers. Aprove depois de enviar para a Coopmetro e inativar no sistema interno.'
          : 'Seus pedidos e os do seu galpão. O motorista só fica inativo depois que a equipe aprovar.'}
      </p>

      <div className="segmentado mb-3 grid grid-cols-2 rounded-[9px] p-0.5" role="tablist">
        {(
          [
            ['pendentes', `Pendentes${pendentes.data ? ` (${agruparPedidos(pendentes.data).length})` : ''}`],
            ['decididas', 'Últimos 30 dias'],
          ] as const
        ).map(([valor, rotulo]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            aria-selected={aba === valor}
            onClick={() => setAba(valor)}
            className="min-h-9 rounded-[7px] text-[13px] font-semibold text-slate-800 transition"
          >
            {rotulo}
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-2">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou placa"
          aria-label="Buscar por nome ou placa"
          className="min-h-11 min-w-0 flex-1 rounded-[10px] border border-transparent bg-[rgb(118_118_128/0.12)] px-4 text-[17px] placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
        />
        {opcoesGalpao.length > 1 && (
          <select
            value={galpao}
            onChange={(e) => setGalpao(e.target.value)}
            aria-label="Filtrar por galpão"
            className="min-h-12 rounded-xl border border-black/5 bg-white px-2 text-sm font-medium"
          >
            <option value="">Galpões</option>
            {opcoesGalpao.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </div>

      {consulta.isPending ? (
        <Carregando texto="Carregando pedidos…" />
      ) : consulta.error ? (
        <EstadoErro mensagem={mensagemErro(consulta.error)} aoTentarDeNovo={() => consulta.refetch()} />
      ) : filtradas.length === 0 ? (
        <EstadoVazio titulo={aba === 'pendentes' ? 'Nenhum pedido pendente' : 'Nenhum pedido nos últimos 30 dias'} />
      ) : (
        <ul className="flex flex-col gap-3">
          {agruparPedidos(filtradas).map((itens) => (
            <li key={itens[0].grupo ?? itens[0].id}>
              <CartaoSolicitacao itens={itens} />
            </li>
          ))}
        </ul>
      )}
    </Pagina>
  )
}
