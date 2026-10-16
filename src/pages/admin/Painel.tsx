import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Carregando, Cartao, EstadoErro, EstadoVazio, Pagina } from '../../components/ui'
import { GALPOES, SEM_GALPAO } from '../../lib/constantes'
import { mensagemErro } from '../../lib/erros'
import { supabase } from '../../lib/supabase'

interface LinhaResumo {
  galpao: string | null
  ativos: number
  inativos: number
}

export default function Painel() {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['resumo'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('resumo_por_galpao')
      if (error) throw error
      return (data ?? []) as LinhaResumo[]
    },
    refetchInterval: 60_000,
  })

  const linhas: LinhaResumo[] = [
    ...GALPOES.map((g) => data?.find((d) => d.galpao === g) ?? { galpao: g, ativos: 0, inativos: 0 }),
    ...(data?.filter((d) => d.galpao === null) ?? []),
  ]
  const total = linhas.reduce((t, l) => ({ ativos: t.ativos + Number(l.ativos), inativos: t.inativos + Number(l.inativos) }), {
    ativos: 0,
    inativos: 0,
  })

  return (
    <Pagina titulo="Painel">
      <div className="mb-4 grid grid-cols-2 gap-2">
        <Link to="/admin/dispatchers" className="flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white font-semibold text-sky-800">
          👥 Equipe
        </Link>
        <Link to="/admin/importar" className="flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white font-semibold text-sky-800">
          📄 Importar / Exportar
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
            <p className="text-sm text-slate-500">Total geral</p>
            <div className="mt-1 flex gap-6">
              <p>
                <span className="text-3xl font-bold text-emerald-700">{total.ativos}</span>{' '}
                <span className="text-slate-600">ativos</span>
              </p>
              <p>
                <span className="text-3xl font-bold text-rose-600">{total.inativos}</span>{' '}
                <span className="text-slate-600">inativos</span>
              </p>
            </div>
          </Cartao>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {linhas.map((l) => {
              const soma = Number(l.ativos) + Number(l.inativos)
              const pct = soma ? Math.round((Number(l.ativos) / soma) * 100) : 0
              return (
                <li key={l.galpao ?? SEM_GALPAO}>
                  <Link
                    to={`/?galpao=${l.galpao ?? SEM_GALPAO}`}
                    className={`block rounded-2xl border bg-white p-4 shadow-sm ${l.galpao ? 'border-slate-200' : 'border-amber-300'}`}
                  >
                    <p className="font-bold text-slate-900">{l.galpao ?? 'Sem galpão'}</p>
                    <p className="mt-1 text-sm">
                      <span className="font-semibold text-emerald-700">{l.ativos} ativos</span>
                      <br />
                      <span className="text-rose-600">{l.inativos} inativos</span>
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-rose-100" aria-hidden>
                      <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </Pagina>
  )
}
