import { useDeferredValue, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { CartaoNotificacoes } from '../components/AtivarNotificacoes'
import { CartaoSolicitacao } from '../components/CartaoSolicitacao'
import { useToast } from '../components/Toast'
import { Botao, Carregando, EstadoErro, EstadoVazio, Pagina, SeloPlanilha } from '../components/ui'
import {
  chaveAlerta,
  LIMITE_ALERTAS,
  useAlertas,
  useAlertasLidos,
  useMarcarAlertasLidos,
  useMarcarAlertasVistos,
  useMotoristas,
} from '../hooks/motoristas'
import { agruparPedidos, useMeusPedidosDecididos } from '../hooks/solicitacoes'
import { GALPOES, SEM_GALPAO } from '../lib/constantes'
import { formatarData, formatarDataHora, tempoRelativo } from '../lib/datas'
import { mensagemErro } from '../lib/erros'
import { DIAS_CORTE, diasSemRota, paraCortar } from '../lib/rotas'

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

type Aba = 'inativacoes' | 'cortar' | 'pedidos'


/**
 * Alertas dos galpões do usuário. Um alerta continua "não lido" até a pessoa
 * tocar em "Marcar como lido": abrir a aba ou o motorista não marca nada.
 */
export default function Alertas() {
  const { usuario, session, ehAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const toast = useToast()

  const aba = (params.get('aba') as Aba) || 'inativacoes'
  const soNaoLidos = params.get('nao_lidos') === '1'
  const hoje = diaRelativo(0)
  // Igual ao banco: inativações com mais de 30 dias não contam mais como não lidas.
  const inicioNaoLidos = diaRelativo(30)
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

  const inativacoes = useAlertas({ de, ate, galpao })
  const motoristas = useMotoristas()
  const pedidos = useMeusPedidosDecididos(session?.user.id)
  const lidos = useAlertasLidos()
  const marcar = useMarcarAlertasLidos()
  const marcarVistos = useMarcarAlertasVistos()

  const opcoesGalpao = ehAdmin ? [...GALPOES] : (usuario?.galpoes ?? [])
  const mostrarFiltroGalpao = ehAdmin || opcoesGalpao.length > 1
  const termo = semAcento(buscaAdiada.trim())
  const termoPlaca = termo.replace(/[^a-z0-9]/g, '')

  function bate(nome: string | null | undefined, placa: string | null | undefined, galpaoItem?: string | null) {
    if (galpao === SEM_GALPAO && galpaoItem !== null && galpaoItem !== undefined) return false
    if (galpao && galpao !== SEM_GALPAO && galpaoItem !== undefined && galpaoItem !== galpao) return false
    if (!termo) return true
    return (
      semAcento(nome ?? '').includes(termo) ||
      (!!termoPlaca && semAcento(placa ?? '').replace(/[^a-z0-9]/g, '').includes(termoPlaca))
    )
  }

  const lido = (chave: string) => lidos.data?.has(chave) ?? true

  // ----- Inativações -----
  const itensInativacao = (inativacoes.data ?? []).map((a) => ({
    a,
    chave: chaveAlerta.inativacao(a.id),
    naoLido:
      a.alterado_por !== session?.user.id &&
      a.alterado_em.slice(0, 10) >= inicioNaoLidos &&
      !lido(chaveAlerta.inativacao(a.id)),
  }))

  // ----- Para cortar: ativos sem rota há DIAS_CORTE+ dias -----
  const itensCorte = (motoristas.data ?? [])
    .filter((m) => m.status === 'ativo' && paraCortar(m))
    .map((m) => ({ m, dias: diasSemRota(m) ?? 0, chave: chaveAlerta.corte(m), naoLido: !lido(chaveAlerta.corte(m)) }))
    .sort((x, y) => y.dias - x.dias)

  // ----- Meus pedidos aprovados/recusados -----
  const itensPedido = agruparPedidos(pedidos.data ?? []).map((itens) => ({
    itens,
    chave: chaveAlerta.pedido(itens[0]),
    naoLido: !lido(chaveAlerta.pedido(itens[0])),
  }))

  const naoLidos = {
    inativacoes: itensInativacao.filter((i) => i.naoLido).length,
    cortar: itensCorte.filter((i) => i.naoLido).length,
    pedidos: itensPedido.filter((i) => i.naoLido).length,
  }

  const inativacoesVisiveis = itensInativacao.filter(
    (i) => (!soNaoLidos || i.naoLido) && bate(i.a.motoristas?.nome_completo, i.a.motoristas?.placa),
  )
  const corteVisiveis = itensCorte.filter((i) => (!soNaoLidos || i.naoLido) && bate(i.m.nome_completo, i.m.placa, i.m.galpao))
  const pedidosVisiveis = itensPedido.filter(
    (i) => (!soNaoLidos || i.naoLido) && bate(i.itens[0].motoristas?.nome_completo, i.itens[0].motoristas?.placa, i.itens[0].galpao),
  )

  const visiveis = aba === 'inativacoes' ? inativacoesVisiveis : aba === 'cortar' ? corteVisiveis : pedidosVisiveis
  const chavesNaoLidasVisiveis = visiveis.filter((i) => i.naoLido).map((i) => i.chave)

  function marcarComoLido(chaves: string[]) {
    marcar.mutate(chaves, { onError: (e) => toast(`Não foi possível marcar: ${mensagemErro(e)}`, 'erro') })
  }

  const consulta = aba === 'inativacoes' ? inativacoes : aba === 'cortar' ? motoristas : pedidos
  const atalhoAtivo = ATALHOS.find(([, dias]) => de === diaRelativo(dias) && ate === hoje)?.[0]
  const temFiltro = !!busca || !!galpao || soNaoLidos || (aba === 'inativacoes' && atalhoAtivo !== '30 dias')

  return (
    <Pagina titulo="Alertas">
      <CartaoNotificacoes />

      <div className="mb-3 grid grid-cols-3 rounded-xl border border-slate-300 bg-white p-1" role="tablist">
        {(
          [
            ['inativacoes', 'Inativações', naoLidos.inativacoes],
            ['cortar', `Cortar (${DIAS_CORTE}+ dias)`, naoLidos.cortar],
            ['pedidos', 'Meus pedidos', naoLidos.pedidos],
          ] as const
        ).map(([valor, rotulo, qtd]) => (
          <button
            key={valor}
            type="button"
            role="tab"
            aria-selected={aba === valor}
            onClick={() => definir({ aba: valor === 'inativacoes' ? '' : valor })}
            className={`flex min-h-11 items-center justify-center gap-1 rounded-lg px-1 text-sm font-semibold ${aba === valor ? 'bg-sky-700 text-white' : 'text-slate-600'}`}
          >
            {rotulo}
            {qtd > 0 && (
              <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-amber-950" aria-label={`${qtd} não lidos`}>
                {qtd}
              </span>
            )}
          </button>
        ))}
      </div>

      <p className="mb-3 text-slate-600">
        {aba === 'inativacoes'
          ? 'Motoristas inativados no app ou na planilha interna.'
          : aba === 'cortar'
            ? `Motoristas ativos sem rota há ${DIAS_CORTE} dias ou mais: avalie o corte.`
            : 'Seus pedidos de inativação e reativação que já foram aprovados ou recusados.'}
      </p>

      <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3">
        <input
          type="search"
          value={busca}
          onChange={(e) => definir({ q: e.target.value })}
          placeholder="Buscar por nome ou placa"
          aria-label="Buscar por nome ou placa"
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-4 text-base focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
        />

        {aba === 'inativacoes' && (
          <>
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
          </>
        )}

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

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={soNaoLidos}
              onChange={(e) => definir({ nao_lidos: e.target.checked ? '1' : '' })}
              className="h-5 w-5 accent-sky-700"
            />
            Só não lidos
          </label>
          {temFiltro && (
            <button
              type="button"
              onClick={() => setParams(aba === 'inativacoes' ? {} : { aba }, { replace: true })}
              className="min-h-11 rounded-xl px-2 text-sm font-medium text-sky-800"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {consulta.isPending || lidos.isPending ? (
        <Carregando texto="Carregando alertas…" />
      ) : consulta.error ? (
        <EstadoErro mensagem={mensagemErro(consulta.error)} aoTentarDeNovo={() => consulta.refetch()} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-slate-600" aria-live="polite">
              {consulta.isFetching ? 'Atualizando…' : `${visiveis.length} alerta(s)`}
              {aba === 'inativacoes' ? ` de ${formatarData(de)} a ${formatarData(ate)}` : ''}
              {chavesNaoLidasVisiveis.length ? ` · ${chavesNaoLidasVisiveis.length} não lido(s)` : ''}
            </p>
            {chavesNaoLidasVisiveis.length > 0 && (
              <Botao
                variante="secundario"
                carregando={marcar.isPending}
                onClick={() => {
                  marcarComoLido(chavesNaoLidasVisiveis)
                  if (aba === 'inativacoes') marcarVistos.mutate()
                }}
              >
                Marcar todos como lidos
              </Botao>
            )}
          </div>

          {aba === 'inativacoes' && (inativacoes.data?.length ?? 0) >= LIMITE_ALERTAS && (
            <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Mostrando as {LIMITE_ALERTAS} mais recentes. Diminua o período para ver o restante.
            </p>
          )}

          {visiveis.length === 0 ? (
            <EstadoVazio titulo={soNaoLidos ? 'Nenhum alerta não lido' : 'Nenhum alerta'}>
              {soNaoLidos ? 'Tudo lido por aqui.' : 'Tente outro período, galpão ou nome.'}
            </EstadoVazio>
          ) : (
            <ul className="flex flex-col gap-3">
              {aba === 'inativacoes' &&
                inativacoesVisiveis.map(({ a, chave, naoLido }) => (
                  <ItemAlerta key={chave} naoLido={naoLido} aoMarcar={() => marcarComoLido([chave])}>
                    <Link to={`/motoristas/${a.motorista_id}`} className="block">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-slate-900">
                          {a.motoristas?.nome_completo ?? a.motoristas?.codigo ?? 'Motorista'}
                          {a.motoristas?.placa ? <span className="font-normal text-slate-500"> · {a.motoristas.placa}</span> : null}
                        </p>
                        {a.origem === 'planilha' && <SeloPlanilha />}
                      </div>
                      <p className="mt-1 text-rose-700">
                        Inativado{a.motivo ? ` · ${a.motivo}` : ''}
                        {a.galpao ? ` · ${a.galpao}` : ''}
                      </p>
                      {a.observacao && <p className="mt-1 text-sm text-slate-600">“{a.observacao}”</p>}
                      <p className="mt-2 text-sm text-slate-500">
                        {a.alterado_por_nome ?? (a.origem === 'planilha' ? 'Planilha interna' : 'Usuário removido')} ·{' '}
                        {formatarDataHora(a.alterado_em)} ({tempoRelativo(a.alterado_em)})
                      </p>
                    </Link>
                  </ItemAlerta>
                ))}

              {aba === 'cortar' &&
                corteVisiveis.map(({ m, dias, chave, naoLido }) => (
                  <ItemAlerta key={chave} naoLido={naoLido} aoMarcar={() => marcarComoLido([chave])}>
                    <Link to={`/motoristas/${m.id}`} className="block">
                      <p className="font-semibold text-slate-900">
                        {m.nome_completo ?? m.codigo}
                        {m.placa ? <span className="font-normal text-slate-500"> · {m.placa}</span> : null}
                      </p>
                      <p className="mt-1 font-semibold text-rose-700">
                        Sem rota há {dias} dias{m.galpao ? ` · ${m.galpao}` : ''}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        Última rota em {formatarData(m.ultima_rota)}
                        {m.qtd_rotas != null ? ` · ${m.qtd_rotas} rota(s) no total` : ''}
                      </p>
                    </Link>
                  </ItemAlerta>
                ))}

              {aba === 'pedidos' &&
                pedidosVisiveis.map(({ itens, chave, naoLido }) => (
                  <ItemAlerta key={chave} naoLido={naoLido} aoMarcar={() => marcarComoLido([chave])}>
                    <CartaoSolicitacao itens={itens} />
                  </ItemAlerta>
                ))}
            </ul>
          )}
        </>
      )}
    </Pagina>
  )
}

/** Moldura de um alerta: destaque e botão "Marcar como lido" enquanto não for lido. */
function ItemAlerta({ naoLido, aoMarcar, children }: { naoLido: boolean; aoMarcar: () => void; children: ReactNode }) {
  return (
    <li className={`rounded-2xl border p-4 ${naoLido ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-white'}`}>
      {naoLido && (
        <span className="mb-2 inline-block rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold uppercase text-amber-900">
          Não lido
        </span>
      )}
      {children}
      {naoLido && (
        <button
          type="button"
          onClick={aoMarcar}
          className="mt-3 inline-flex min-h-11 items-center rounded-xl border border-amber-400 bg-white px-3 text-sm font-semibold text-amber-900 hover:bg-amber-100"
        >
          ✓ Marcar como lido
        </button>
      )}
    </li>
  )
}
