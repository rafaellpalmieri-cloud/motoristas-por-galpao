import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Botao, Carregando, Cartao, EstadoErro, Pagina } from '../../components/ui'
import { baixarCsv } from '../../lib/csv'
import { mensagemErro } from '../../lib/erros'
import { supabase } from '../../lib/supabase'

interface Relatorio {
  inicio: string
  fim: string
  totais: { inativacoes: number; reativacoes: number; inativacoes_planilha: number; inativacoes_app: number }
  por_motivo: { motivo: string; quantidade: number }[]
  por_galpao: { galpao: string | null; inativacoes: number; reativacoes: number }[]
  por_dispatcher: {
    nome: string
    pedidos: number
    aprovados: number
    recusados: number
    cancelados: number
    pendentes: number
  }[]
  tempo_medio_aprovacao_horas: number | null
}

function mesAtual() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7)
}

function nomeMes(mes: string) {
  const [a, m] = mes.split('-').map(Number)
  return new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function Tabela({ titulo, cabecalho, linhas }: { titulo: string; cabecalho: string[]; linhas: ReactNode[][] }) {
  return (
    <Cartao className="mb-4 overflow-x-auto">
      <p className="mb-2 font-semibold text-slate-800">{titulo}</p>
      {linhas.length === 0 ? (
        <p className="text-sm text-slate-500">Nada neste mês.</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              {cabecalho.map((c, i) => (
                <th key={c} className={`py-1 pr-3 font-medium ${i > 0 ? 'text-right' : ''}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l, i) => (
              <tr key={i} className="border-t border-slate-100">
                {l.map((v, j) => (
                  <td key={j} className={`py-1.5 pr-3 ${j > 0 ? 'text-right tabular-nums' : ''}`}>
                    {v}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Cartao>
  )
}

/** Relatório mensal de inativações, reativações e pedidos (só admin). */
export default function RelatorioMensal() {
  const [mes, setMes] = useState(mesAtual())
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['relatorio', mes],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('relatorio_mensal', { p_mes: `${mes}-01` })
      if (error) throw error
      return data as Relatorio
    },
  })

  function exportar() {
    if (!data) return
    const linhas: Record<string, unknown>[] = [
      { secao: 'Totais', item: 'Inativações', valor: data.totais.inativacoes },
      { secao: 'Totais', item: 'Inativações pelo app', valor: data.totais.inativacoes_app },
      { secao: 'Totais', item: 'Inativações pela planilha', valor: data.totais.inativacoes_planilha },
      { secao: 'Totais', item: 'Reativações', valor: data.totais.reativacoes },
      { secao: 'Totais', item: 'Tempo médio de aprovação (h)', valor: data.tempo_medio_aprovacao_horas ?? '' },
      ...data.por_motivo.map((m) => ({ secao: 'Por motivo', item: m.motivo, valor: m.quantidade })),
      ...data.por_galpao.flatMap((g) => [
        { secao: 'Por galpão', item: `${g.galpao ?? 'Sem galpão'} - inativações`, valor: g.inativacoes },
        { secao: 'Por galpão', item: `${g.galpao ?? 'Sem galpão'} - reativações`, valor: g.reativacoes },
      ]),
      ...data.por_dispatcher.flatMap((d) => [
        { secao: 'Por dispatcher', item: `${d.nome} - pedidos`, valor: d.pedidos },
        { secao: 'Por dispatcher', item: `${d.nome} - aprovados`, valor: d.aprovados },
        { secao: 'Por dispatcher', item: `${d.nome} - recusados`, valor: d.recusados },
      ]),
    ]
    baixarCsv(`relatorio-${mes}.csv`, linhas, ['secao', 'item', 'valor'])
  }

  return (
    <Pagina titulo="Relatório mensal">
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          Mês
          <input
            type="month"
            value={mes}
            max={mesAtual()}
            onChange={(e) => e.target.value && setMes(e.target.value)}
            className="min-h-11 rounded-xl border border-black/5 bg-white px-3 text-base"
          />
        </label>
        <Botao variante="secundario" disabled={!data} onClick={exportar}>
          ⬇️ Exportar CSV
        </Botao>
      </div>

      {isPending ? (
        <Carregando />
      ) : error ? (
        <EstadoErro mensagem={mensagemErro(error)} aoTentarDeNovo={() => refetch()} />
      ) : (
        <>
          <p className="mb-3 text-slate-600 first-letter:uppercase">{nomeMes(mes)}</p>
          <Cartao className="mb-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-3xl font-bold text-rose-600">{data.totais.inativacoes}</p>
                <p className="text-sm text-slate-600">
                  inativações ({data.totais.inativacoes_app} app · {data.totais.inativacoes_planilha} planilha)
                </p>
              </div>
              <div>
                <p className="text-3xl font-bold text-emerald-700">{data.totais.reativacoes}</p>
                <p className="text-sm text-slate-600">reativações</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-sky-700">
                  {data.tempo_medio_aprovacao_horas != null ? `${data.tempo_medio_aprovacao_horas} h` : '—'}
                </p>
                <p className="text-sm text-slate-600">tempo médio para responder pedidos</p>
              </div>
              <div>
                <p className="text-3xl font-bold text-slate-800">
                  {data.por_dispatcher.reduce((t, d) => t + d.pedidos, 0)}
                </p>
                <p className="text-sm text-slate-600">pedidos de inativação</p>
              </div>
            </div>
          </Cartao>

          <Tabela
            titulo="Inativações por motivo"
            cabecalho={['Motivo', 'Quantidade']}
            linhas={data.por_motivo.map((m) => [m.motivo, m.quantidade])}
          />
          <Tabela
            titulo="Por galpão"
            cabecalho={['Galpão', 'Inativações', 'Reativações']}
            linhas={data.por_galpao.map((g) => [g.galpao ?? 'Sem galpão', g.inativacoes, g.reativacoes])}
          />
          <Tabela
            titulo="Pedidos por dispatcher"
            cabecalho={['Dispatcher', 'Pedidos', 'Aprovados', 'Recusados', 'Cancelados', 'Pendentes']}
            linhas={data.por_dispatcher.map((d) => [d.nome, d.pedidos, d.aprovados, d.recusados, d.cancelados, d.pendentes])}
          />
        </>
      )}
    </Pagina>
  )
}
