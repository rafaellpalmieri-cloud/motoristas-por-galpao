import { useDeferredValue, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { CardPessoa } from '../components/CardPessoa'
import { ModalStatus, type AlvoStatus } from '../components/ModalStatus'
import { ehPausado, jaOperou } from '../lib/pausados'
import { Carregando, EstadoErro, EstadoVazio, Pagina } from '../components/ui'
import { useCpfsCompletos, useMotoristas } from '../hooks/motoristas'
import { usePendentes } from '../hooks/solicitacoes'
import { GALPOES, SEM_GALPAO } from '../lib/constantes'
import { baixarCsv } from '../lib/csv'
import { mensagemErro } from '../lib/erros'
import { DIAS_PARADO, DIAS_SEM_ROTA_INICIO, diasSemRota, FAIXAS_SEM_ROTA, formatarCpf, nuncaRodou, parado } from '../lib/rotas'
import type { Motorista } from '../lib/tipos'

type FiltroStatus = 'todos' | 'ativo' | 'inativo' | 'pausado'
const POR_PAGINA = 60

function semAcento(texto: string) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export default function Motoristas() {
  const { usuario, ehAdmin, session } = useAuth()
  const { data, isPending, error, refetch } = useMotoristas()
  const { data: pendentes } = usePendentes()
  const { data: cpfsCompletos } = useCpfsCompletos(ehAdmin)
  const pendentePorMotorista = useMemo(() => new Map((pendentes ?? []).map((s) => [s.motorista_id, s])), [pendentes])
  const [params, setParams] = useSearchParams()
  const [alvo, setAlvo] = useState<AlvoStatus | null>(null)
  const [limite, setLimite] = useState(POR_PAGINA)

  const busca = params.get('q') ?? ''
  const buscaAdiada = useDeferredValue(busca)
  const status = (params.get('status') as FiltroStatus) || 'todos'
  // Dentro de Pausados: quem já operou (padrão) ou quem nunca operou.
  const nuncaOperou = params.get('pausados') === 'nunca'
  const rota = params.get('rota') ?? ''
  const faixa = FAIXAS_SEM_ROTA.find(([valor]) => valor === rota)
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

  // Placas (cadastros) agrupadas por pessoa.
  const porPessoa = useMemo(() => {
    const mapa = new Map<string, Motorista[]>()
    for (const m of doGalpao) {
      const chave = m.pessoa_id ?? m.id
      mapa.set(chave, [...(mapa.get(chave) ?? []), m])
    }
    return mapa
  }, [doGalpao])

  // Motorista ativo = tem ao menos uma placa ativa; pausado = todas as placas pausadas no CRM.
  const contagem = useMemo(() => {
    let ativos = 0
    let pausados = 0
    for (const placas of porPessoa.values()) {
      if (placas.some((p) => p.status === 'ativo')) ativos++
      else if (placas.every(ehPausado)) pausados++
    }
    const placasPausadas = doGalpao.filter(ehPausado)
    const operaram = placasPausadas.filter(jaOperou).length
    return {
      ativos,
      pausados,
      inativos: porPessoa.size - ativos - pausados,
      operaram,
      nuncaOperaram: placasPausadas.length - operaram,
    }
  }, [porPessoa, doGalpao])

  const filtrados = useMemo(() => {
    const termo = semAcento(buscaAdiada.trim())
    const termoPlaca = termo.replace(/[^a-z0-9]/g, '')
    // Busca por CPF só quando o termo é numérico (com ou sem pontos/traço).
    const termoCpf = /^[\d.\-\s]{4,}$/.test(termo) ? termo.replace(/\D/g, '') : ''
    return doGalpao.filter((m) => {
      // Pausados do CRM ficam só na aba deles.
      if (status === 'pausado') {
        if (!ehPausado(m) || jaOperou(m) === nuncaOperou) return false
      } else {
        if (ehPausado(m)) return false
        if (status !== 'todos' && m.status !== status) return false
      }
      if (rota === 'nunca' && !nuncaRodou(m)) return false
      if (rota === 'parado' && !parado(m)) return false
      if (rota === 'sem10' && (diasSemRota(m) ?? -1) < DIAS_SEM_ROTA_INICIO) return false
      if (faixa) {
        const dias = diasSemRota(m)
        if (dias === null || dias < faixa[2] || dias > faixa[3]) return false
      }
      if (!termo) return true
      return (
        semAcento(m.nome_completo ?? '').includes(termo) ||
        (!!termoPlaca && semAcento(m.placa ?? '').replace(/[^a-z0-9]/g, '').includes(termoPlaca)) ||
        (!!termoCpf &&
          (cpfsCompletos?.get(m.id) ?? (m.cpf_mascarado ?? '').replace(/\D/g, '')).includes(termoCpf))
      )
    })
  }, [doGalpao, buscaAdiada, status, nuncaOperou, rota, faixa, cpfsCompletos])

  // Mostra a pessoa inteira (todas as placas) se qualquer placa dela passou no filtro.
  const pessoas = useMemo(() => {
    const vistas = new Set<string>()
    const lista: Motorista[][] = []
    for (const m of filtrados) {
      const chave = m.pessoa_id ?? m.id
      if (vistas.has(chave)) continue
      vistas.add(chave)
      lista.push(porPessoa.get(chave) ?? [m])
    }
    return lista
  }, [filtrados, porPessoa])

  // Admin vê o CPF completo; dispatcher, o mascarado.
  function cpfDaPessoa(placas: Motorista[]): string | null {
    for (const p of placas) {
      const completo = cpfsCompletos?.get(p.id)
      if (completo) return formatarCpf(completo)
      if (p.cpf_mascarado) return p.cpf_mascarado
    }
    return null
  }

  /** Exporta as placas que estão na tela (com os filtros aplicados). CPF como aparece para quem exporta. */
  function exportarCsv() {
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
    const linhas = pessoas.flatMap((placas) => {
      const cpf = cpfDaPessoa(placas) ?? ''
      return placas.map((m) => ({
        codigo: m.codigo,
        nome: m.nome_completo ?? '',
        cpf,
        celular: m.celular ?? '',
        placa: m.placa ?? '',
        modal: m.modal ?? '',
        galpao: m.galpao ?? '',
        status: ehPausado(m) ? 'pausado' : m.status,
        inativo_desde: m.inativo_desde ?? '',
        motivo_inativacao: m.motivo_inativacao ?? '',
        fez_rota: m.realizou_rotas == null ? '' : m.realizou_rotas ? 'SIM' : 'NÃO',
        qtd_rotas: m.qtd_rotas ?? '',
        ultima_rota: m.ultima_rota ?? '',
        dias_sem_rota: diasSemRota(m) ?? '',
      }))
    })
    baixarCsv(`motoristas-${hoje}.csv`, linhas, Object.keys(linhas[0]))
  }

  function ehNovo(m: Motorista) {
    return (
      m.status === 'inativo' && !!vistosEm && m.atualizado_em > vistosEm && m.atualizado_por !== session?.user.id
    )
  }

  return (
    <Pagina titulo="Motoristas">
      <div className="sticky top-16 z-10 -mx-4 mb-3 flex flex-col gap-2 bg-slate-50/95 px-4 pb-2 pt-1 backdrop-blur">
        <input
          type="search"
          value={busca}
          onChange={(e) => definir('q', e.target.value)}
          placeholder="Buscar por nome, placa ou CPF"
          aria-label="Buscar por nome, placa ou CPF"
          className="min-h-11 w-full rounded-[10px] border border-transparent bg-[rgb(118_118_128/0.12)] px-4 text-[17px] placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
        />
        <div className="flex gap-2">
          <div role="group" aria-label="Filtrar por status" className="segmentado grid flex-1 grid-cols-4 rounded-[9px] p-0.5">
            {(
              [
                ['todos', 'Todos'],
                ['ativo', 'Ativos'],
                ['inativo', 'Inativos'],
                ['pausado', 'Pausados'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                aria-pressed={status === valor}
                onClick={() => {
                  setLimite(POR_PAGINA)
                  setParams(
                    (p) => {
                      if (valor === 'todos') p.delete('status')
                      else p.set('status', valor)
                      if (valor !== 'pausado') p.delete('pausados')
                      return p
                    },
                    { replace: true },
                  )
                }}
                className="min-h-9 rounded-[7px] text-[13px] font-semibold text-slate-800 transition"
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
              className="min-h-12 rounded-xl border border-black/5 bg-white px-2 text-sm font-medium"
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
        {status === 'pausado' && (
          <div role="group" aria-label="Pausados" className="segmentado grid grid-cols-2 rounded-[9px] p-0.5">
            {(
              [
                ['', `Já operaram (${contagem.operaram})`],
                ['nunca', `Nunca operaram (${contagem.nuncaOperaram})`],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor || 'operaram'}
                type="button"
                aria-pressed={nuncaOperou === (valor === 'nunca')}
                onClick={() => definir('pausados', valor)}
                className="min-h-9 rounded-[7px] text-[13px] font-semibold text-slate-800 transition"
              >
                {rotulo}
              </button>
            ))}
          </div>
        )}
        {status === 'pausado' && (
          <p className="px-1 text-[13px] text-slate-500">
            Pausados no CRM. "Já operaram" = têm ID Coopmetro ou já fizeram rota.
          </p>
        )}
        <select
          value={rota}
          onChange={(e) => definir('rota', e.target.value)}
          aria-label="Filtrar por rotas"
          className="min-h-11 rounded-xl border border-black/5 bg-white px-3 text-sm font-medium"
        >
          <option value="">Rotas: todos</option>
          <option value="nunca">Nunca fez rota</option>
          {FAIXAS_SEM_ROTA.map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
          {/* Atalho do painel e do lembrete semanal. */}
          {rota === 'parado' && <option value="parado">Sem rota há {DIAS_PARADO}+ dias</option>}
          {rota === 'sem10' && <option value="sem10">Sem rota há {DIAS_SEM_ROTA_INICIO}+ dias</option>}
        </select>
        {data && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-full bg-emerald-100 px-3 py-1 font-semibold text-emerald-800">{contagem.ativos} motoristas ativos</span>
            <span className="rounded-full bg-rose-50 px-3 py-1 font-semibold text-rose-700">{contagem.inativos} inativos</span>
            <span className="rounded-full bg-amber-50 px-3 py-1 font-semibold text-amber-800">{contagem.pausados} pausados</span>
            <span className="px-1 py-1 text-slate-500">{doGalpao.length} placas</span>
            <button
              type="button"
              onClick={exportarCsv}
              disabled={!pessoas.length}
              className="ml-auto inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-300 bg-white px-3 font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              ⬇ Exportar CSV
            </button>
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
      ) : pessoas.length === 0 ? (
        <EstadoVazio titulo="Nenhum resultado">Tente outro nome, placa ou filtro.</EstadoVazio>
      ) : (
        <>
          <ul className="escalonar flex flex-col gap-3">
            {pessoas.slice(0, limite).map((placas) => (
              <CardPessoa
                key={placas[0].pessoa_id ?? placas[0].id}
                placas={placas}
                novos={new Set(placas.filter(ehNovo).map((p) => p.id))}
                mostrarGalpao={mostrarFiltroGalpao}
                pendentes={pendentePorMotorista}
                cpf={cpfDaPessoa(placas)}
                aoAlterarStatus={setAlvo}
              />
            ))}
          </ul>
          {pessoas.length > limite && (
            <button
              type="button"
              onClick={() => setLimite((l) => l + POR_PAGINA)}
              className="mt-4 min-h-12 w-full rounded-xl border border-slate-300 bg-white font-semibold text-sky-800"
            >
              Mostrar mais ({pessoas.length - limite} restantes)
            </button>
          )}
        </>
      )}

      <ModalStatus alvo={alvo} aoFechar={() => setAlvo(null)} />
    </Pagina>
  )
}
