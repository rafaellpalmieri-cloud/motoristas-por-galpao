import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Carregando, Cartao, EstadoErro, EstadoVazio, Pagina } from '../../components/ui'
import { GALPOES, SEM_GALPAO } from '../../lib/constantes'
import { mensagemErro } from '../../lib/erros'
import { DIAS_PARADO } from '../../lib/rotas'
import { supabase } from '../../lib/supabase'

interface LinhaPainel {
  galpao: string | null
  ativos: number
  inativos: number
  nunca_rodou: number
  parados_30: number
  pedidos_pendentes: number
  pedidos_atrasados: number
}

const VAZIA = { ativos: 0, inativos: 0, nunca_rodou: 0, parados_30: 0, pedidos_pendentes: 0, pedidos_atrasados: 0 }

function Numero({ valor, rotulo, cor, para }: { valor: number; rotulo: string; cor: string; para?: string }) {
  const conteudo = (
    <>
      <span className={`block text-3xl font-bold ${cor}`}>{valor}</span>
      <span className="text-sm text-slate-600">{rotulo}</span>
    </>
  )
  return para ? (
    <Link to={para} className="rounded-xl p-2 hover:bg-slate-50">
      {conteudo}
    </Link>
  ) : (
    <div className="p-2">{conteudo}</div>
  )
}

export default function Painel() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['resumo'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('painel_atencao')
      if (error) throw error
      return ((data ?? []) as LinhaPainel[]).map((l) => ({
        ...l,
        ativos: Number(l.ativos),
        inativos: Number(l.inativos),
        nunca_rodou: Number(l.nunca_rodou),
        parados_30: Number(l.parados_30),
        pedidos_pendentes: Number(l.pedidos_pendentes),
        pedidos_atrasados: Number(l.pedidos_atrasados),
      }))
    },
    refetchInterval: 60_000,
  })

  const linhas: LinhaPainel[] = [
    ...GALPOES.map((g) => data?.find((d) => d.galpao === g) ?? { galpao: g, ...VAZIA }),
    ...(data?.filter((d) => d.galpao === null) ?? []),
  ]
  const total = linhas.reduce(
    (t, l) => ({
      ativos: t.ativos + l.ativos,
      inativos: t.inativos + l.inativos,
      nunca_rodou: t.nunca_rodou + l.nunca_rodou,
      parados_30: t.parados_30 + l.parados_30,
      pedidos_pendentes: t.pedidos_pendentes + l.pedidos_pendentes,
      pedidos_atrasados: t.pedidos_atrasados + l.pedidos_atrasados,
    }),
    { ...VAZIA },
  )

  return (
    <Pagina titulo="Painel">
      <div className="mb-4 grid grid-cols-3 gap-2">
        <Link to="/admin/dispatchers" className="flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white text-sm font-semibold text-sky-800">
          Equipe
        </Link>
        <Link to="/admin/relatorio" className="flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white text-sm font-semibold text-sky-800">
          Relatório
        </Link>
        <Link to="/admin/importar" className="flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white text-sm font-semibold text-sky-800">
          CSV
        </Link>
      </div>

      {isPending ? (
        <Carregando />
      ) : error ? (
        <EstadoErro mensagem={mensagemErro(error)} aoTentarDeNovo={() => refetch()} />
      ) : total.ativos + total.inativos === 0 ? (
        <EstadoVazio titulo="Nenhum motorista cadastrado">
          <Link to="/admin/importar" className="font-semibold text-sky-800">
            Importe o CSV
          </Link>{' '}
          para começar.
        </EstadoVazio>
      ) : (
        <>
          <Cartao className="mb-4">
            <p className="mb-1 text-sm font-semibold text-slate-700">Precisa de atenção</p>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
              <Numero valor={total.nunca_rodou} rotulo="ativos que nunca rodaram" cor="text-orange-600" para="/?status=ativo&rota=nunca" />
              <Numero
                valor={total.parados_30}
                rotulo={`ativos sem rota há ${DIAS_PARADO}+ dias`}
                cor="text-amber-600"
                para="/?status=ativo&rota=parado"
              />
              <Numero valor={total.pedidos_pendentes} rotulo="pedidos pendentes" cor="text-sky-700" para="/pendencias" />
              <Numero
                valor={total.pedidos_atrasados}
                rotulo="pedidos há mais de 24 h"
                cor={total.pedidos_atrasados ? 'text-rose-600' : 'text-slate-400'}
                para="/pendencias"
              />
            </div>
            <div className="mt-3 flex gap-6 border-t border-slate-100 pt-3 text-sm">
              <p>
                <span className="text-xl font-bold text-emerald-700">{total.ativos}</span> <span className="text-slate-600">placas ativas</span>
              </p>
              <p>
                <span className="text-xl font-bold text-rose-600">{total.inativos}</span> <span className="text-slate-600">inativas</span>
              </p>
            </div>
          </Cartao>

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {linhas.map((l) => {
              const g = l.galpao ?? SEM_GALPAO
              const soma = l.ativos + l.inativos
              const pct = soma ? Math.round((l.ativos / soma) * 100) : 0
              return (
                <li
                  key={g}
                  className={`rounded-2xl border bg-white p-4 shadow-sm ${l.pedidos_atrasados ? 'border-rose-300' : l.galpao ? 'border-slate-200' : 'border-amber-300'}`}
                >
                  <Link to={`/?galpao=${g}`} className="flex items-center justify-between">
                    <p className="font-bold text-slate-900">{l.galpao ?? 'Sem galpão'}</p>
                    <p className="text-sm">
                      <span className="font-semibold text-emerald-700">{l.ativos} ativos</span>
                      <span className="text-slate-400"> · </span>
                      <span className="text-rose-600">{l.inativos} inativos</span>
                    </p>
                  </Link>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-rose-100" aria-hidden>
                    <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-sm">
                    <Link
                      to={`/?galpao=${g}&status=ativo&rota=nunca`}
                      className={`rounded-full px-3 py-1 font-semibold ${l.nunca_rodou ? 'bg-orange-100 text-orange-800' : 'bg-slate-100 text-slate-400'}`}
                    >
                      {l.nunca_rodou} nunca rodou
                    </Link>
                    <Link
                      to={`/?galpao=${g}&status=ativo&rota=parado`}
                      className={`rounded-full px-3 py-1 font-semibold ${l.parados_30 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-400'}`}
                    >
                      {l.parados_30} parados {DIAS_PARADO}+ dias
                    </Link>
                    {l.pedidos_pendentes > 0 && (
                      <Link
                        to="/pendencias"
                        className={`rounded-full px-3 py-1 font-semibold ${l.pedidos_atrasados ? 'bg-rose-100 text-rose-800' : 'bg-sky-100 text-sky-800'}`}
                      >
                        {l.pedidos_pendentes} pedido(s){l.pedidos_atrasados ? ` · ${l.pedidos_atrasados} atrasado(s)` : ''}
                      </Link>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Pagina>
  )
}
