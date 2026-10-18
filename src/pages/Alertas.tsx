import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { CartaoNotificacoes } from '../components/AtivarNotificacoes'
import { Carregando, EstadoErro, EstadoVazio, Pagina, SeloPlanilha } from '../components/ui'
import { LIMITE_ALERTAS, useAlertas, useMarcarAlertasVistos } from '../hooks/motoristas'
import { GALPOES, SEM_GALPAO } from '../lib/constantes'
import { formatarData, formatarDataHora, tempoRelativo } from '../lib/datas'
import { mensagemErro } from '../lib/erros'

/** Data de hoje (horário de Brasília) menos N dias, em AAAA-MM-DD. */
function diaRelativo(dias: number) {
  return new Date(Date.now() - dias * 24 * 3600 * 1000).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
}

function semAcento(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

const ATALHOS = [
  ['Hoje', 0],
  ['7 dias', 6],
  ['30 dias', 29],
  ['90 dias', 89],
] as const

/** Inativações (app e planilha) nos galpões do usuário, com filtros. */
export default function Alertas() {
  const { usuario, session, ehAdmin } = useAuth()
  const [params, setParams] = useSearchParams()

  const hoje = diaRelativo(0)
  const de = params.get('de') || diaRelativo(29)
  const ate = params.get('ate') || hoje
  const galpao = params.get('galpao') ?? ''
  const busca = params.get('q') ?? ''
  const buscaAdiada = useDeferredValue(busca)

  function definir(valores: Record<string, string>) {
    setParams(
      (p) => {
        for (const [k, v] of Object.entries(valores)) {
          if (v) p.set(k, v)
          else p.delete(k)
        }
        return p
      },
      { replace: true },
    )
  }

  const { data, isPending, isFetching, error, refetch } = useAlertas({ de, ate, galpao })
  const marcar = useMarcarAlertasVistos()

  // Guarda o "visto até" de quando a tela abriu, para destacar o que é novo
  // mesmo depois de marcar tudo como visto.
  const [vistosAte] = useState(usuario?.perfil?.alertas_vistos_em)
  const marcou = useRef(false)
  const { mutate } = marcar
  useEffect(() => {
    if (data && !marcou.current) {
      marcou.current = true
      mutate()
    }
  }, [data, mutate])

  const opcoesGalpao = ehAdmin ? [...GALPOES] : (usuario?.galpoes ?? [])
  const mostrarFiltroGalpao = ehAdmin || opcoesGalpao.length > 1

  const filtrados = useMemo(() => {
    const termo = semAcento(buscaAdiada.trim())
    if (!termo || !data) return data ?? []
    const termoPlaca = termo.replace(/[^a-z0-9]/g, '')
    return data.filter(
      (a) =>
        semAcento(a.motoristas?.nome_completo ?? '').includes(termo) ||
        (!!termoPlaca && semAcento(a.motoristas?.placa ?? '').replace(/[^a-z0-9]/g, '').includes(termoPlaca)),
    )
  }, [data, buscaAdiada])

  const atalhoAtivo = ATALHOS.find(([, dias]) => de === diaRelativo(dias) && ate === hoje)?.[0]
  const temFiltro = !!busca || !!galpao || atalhoAtivo !== '30 dias'

  return (
    <Pagina titulo="Alertas">
      <CartaoNotificacoes />

      <p className="mb-3 text-slate-600">Motoristas inativados no app ou na planilha interna.</p>

      <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => definir({ q: e.target.value })}
          placeholder="Buscar por nome ou placa"
          aria-label="Buscar por nome ou placa"
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
        />

        <div className="flex flex-wrap gap-2" role="group" aria-label="Período rápido">
          {ATALHOS.map(([rotulo, dias]) => (
            <button
              key={rotulo}
              type="button"
              aria-pressed={atalhoAtivo === rotulo}
              onClick={() => definir({ de: dias === 29 ? '' : diaRelativo(dias), ate: '' })}
              className={`min-h-10 rounded-full px-4 text-sm font-semibold ${atalhoAtivo === rotulo ? 'bg-sky-700 text-white' : 'border border-slate-300 text-slate-700'}`}
            >
              {rotulo}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            De
            <input
              type="date"
              value={de}
              max={ate}
              onChange={(e) => e.target.value && definir({ de: e.target.value })}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Até
            <input
              type="date"
              value={ate}
              min={de}
              max={hoje}
              onChange={(e) => e.target.value && definir({ ate: e.target.value === hoje ? '' : e.target.value })}
              className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-base"
            />
          </label>
        </div>

        {mostrarFiltroGalpao && (
          <select
            value={galpao}
            onChange={(e) => definir({ galpao: e.target.value })}
            aria-label="Filtrar por galpão"
            className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-base font-medium"
          >
            <option value="">{ehAdmin ? 'Todos os galpões' : 'Meus galpões'}</option>
            {opcoesGalpao.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
            {ehAdmin && <option value={SEM_GALPAO}>Sem galpão</option>}
          </select>
        )}

        {temFiltro && (
          <button
            type="button"
            onClick={() => setParams({}, { replace: true })}
            className="min-h-11 self-start rounded-xl px-2 text-sm font-medium text-sky-800"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {isPending ? (
        <Carregando texto="Carregando alertas…" />
      ) : error ? (
        <EstadoErro mensagem={mensagemErro(error)} aoTentarDeNovo={() => refetch()} />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-600" aria-live="polite">
            {isFetching ? 'Atualizando…' : `${filtrados.length} inativação(ões)`} de {formatarData(de)} a {formatarData(ate)}
            {galpao ? ` · ${galpao === SEM_GALPAO ? 'Sem galpão' : galpao}` : ''}
          </p>
          {data.length >= LIMITE_ALERTAS && (
            <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Mostrando as {LIMITE_ALERTAS} mais recentes. Diminua o período para ver o restante.
            </p>
          )}
          {filtrados.length === 0 ? (
            <EstadoVazio titulo="Nenhuma inativação encontrada">Tente outro período, galpão ou nome.</EstadoVazio>
          ) : (
            <ul className="flex flex-col gap-3">
              {filtrados.map((a) => {
                const novo = !!vistosAte && a.alterado_em > vistosAte && a.alterado_por !== session?.user.id
                return (
                  <li key={a.id}>
                    <Link
                      to={`/motoristas/${a.motorista_id}`}
                      className={`block rounded-2xl border p-4 ${novo ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-slate-900">
                          {a.motoristas?.nome_completo ?? a.motoristas?.codigo ?? 'Motorista'}
                          {a.motoristas?.placa ? (
                            <span className="font-normal text-slate-500"> · {a.motoristas.placa}</span>
                          ) : null}
                        </p>
                        <div className="flex shrink-0 gap-1">
                          {a.origem === 'planilha' && <SeloPlanilha />}
                          {novo && (
                            <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold uppercase text-amber-900">
                              Novo
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 text-rose-700">
                        Inativado{a.motivo ? ` · ${a.motivo}` : ''}
                        {a.galpao ? ` · ${a.galpao}` : ''}
                      </p>
                      {a.observacao && <p className="mt-1 text-sm text-slate-600">“{a.observacao}”</p>}
                      <p className="mt-2 text-sm text-slate-500">
                        {a.alterado_por_nome ?? 'Usuário removido'} · {formatarDataHora(a.alterado_em)} (
                        {tempoRelativo(a.alterado_em)})
                      </p>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </Pagina>
  )
}
