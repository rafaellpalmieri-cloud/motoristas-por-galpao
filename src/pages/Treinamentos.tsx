import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { IconeTelefone } from '../components/Icones'
import { useToast } from '../components/Toast'
import { Botao, Carregando, EstadoErro, EstadoVazio, Modal, Pagina } from '../components/ui'
import { chaveAlerta, useAlertasLidos } from '../hooks/motoristas'
import { DIAS_ANTES, DIAS_DEPOIS, useAgora, useMarcarPresenca, useTreinamentos } from '../hooks/treinamentos'
import { GALPOES } from '../lib/constantes'
import { formatarDataHora } from '../lib/datas'
import { mensagemErro } from '../lib/erros'
import { formatarCelular, linkWhatsApp } from '../lib/telefone'
import type { Presenca, Treinamento } from '../lib/tipos'

const fuso = 'America/Sao_Paulo'

type Aba = 'proximos' | 'realizados'

function dia(iso: string) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: fuso })
}

function hora(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/** "Hoje · 29/10", "Amanhã · 30/10" ou "Sexta · 31/10". */
function rotuloDia(iso: string) {
  const d = dia(iso)
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' }).format(new Date(iso))
  if (d === dia(new Date().toISOString())) return `Hoje · ${data}`
  if (d === dia(new Date(Date.now() + 864e5).toISOString())) return `Amanhã · ${data}`
  if (d === dia(new Date(Date.now() - 864e5).toISOString())) return `Ontem · ${data}`
  const semana = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long' }).format(new Date(iso)).replace('-feira', '')
  return `${semana.charAt(0).toUpperCase()}${semana.slice(1)} · ${data}`
}

/** "qui 23/10" (para a coluna do horário). */
function diaCurto(iso: string) {
  const semana = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'short' }).format(new Date(iso)).replace('.', '')
  const data = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' }).format(new Date(iso))
  return `${semana} ${data}`
}

/** Agrupa em ordem pelo dia do treinamento. */
function porDia(itens: Treinamento[]) {
  const grupos: { chave: string; rotulo: string; itens: Treinamento[] }[] = []
  for (const t of itens) {
    const chave = dia(t.inicio)
    const ultimo = grupos[grupos.length - 1]
    if (ultimo?.chave === chave) ultimo.itens.push(t)
    else grupos.push({ chave, rotulo: rotuloDia(t.inicio), itens: [t] })
  }
  return grupos
}

/**
 * Treinamentos marcados pelo admin (vêm das agendas dos galpões). O dispatcher
 * vê os dos galpões dele e, depois do horário, marca Compareceu ou Faltou.
 */
export default function Treinamentos() {
  const { usuario, ehAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const galpao = params.get('galpao') ?? ''
  const aba: Aba = params.get('aba') === 'realizados' ? 'realizados' : 'proximos'
  const consulta = useTreinamentos()
  const lidos = useAlertasLidos()
  const [marcando, setMarcando] = useState<{ t: Treinamento; presenca: Presenca | null } | null>(null)

  function definir(chave: string, valor: string) {
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
  const variosGalpoes = ehAdmin || opcoesGalpao.length > 1
  const agora = useAgora()
  const todos = (consulta.data ?? []).filter((t) => !galpao || t.galpao === galpao)
  const ativos = todos.filter((t) => t.status === 'agendado')
  const aguardando = ativos.filter((t) => !t.presenca && new Date(t.inicio).getTime() <= agora)
  const proximos = ativos.filter((t) => new Date(t.inicio).getTime() > agora)
  const realizados = ativos.filter((t) => t.presenca).reverse()
  const cancelados = todos.filter((t) => t.status === 'cancelado')

  const novo = (t: Treinamento) => !ehAdmin && !!lidos.data && !lidos.data.has(chaveAlerta.treinamento(t.id))
  // Com um galpão só na tela, o selo do galpão em cada linha é repetição.
  const mostrarGalpao = variosGalpoes && !galpao

  return (
    <Pagina titulo="Treinamentos">
      <div className="mb-4 flex gap-2">
        <div role="tablist" aria-label="Treinamentos" className="segmentado grid flex-1 grid-cols-2 rounded-[9px] p-0.5">
          {(
            [
              ['proximos', 'Próximos', proximos.length],
              ['realizados', 'Realizados', realizados.length],
            ] as const
          ).map(([valor, rotulo, qtd]) => (
            <button
              key={valor}
              type="button"
              role="tab"
              aria-selected={aba === valor}
              onClick={() => definir('aba', valor === 'proximos' ? '' : valor)}
              className="min-h-9 rounded-[7px] text-[13px] font-semibold text-slate-800 transition"
            >
              {rotulo} <span className="font-normal text-slate-500">{qtd}</span>
            </button>
          ))}
        </div>
        {variosGalpoes && (
          <select
            value={galpao}
            onChange={(e) => definir('galpao', e.target.value)}
            aria-label="Filtrar por galpão"
            className="min-h-10 rounded-xl border border-black/5 bg-white px-2 text-sm font-medium"
          >
            <option value="">{ehAdmin ? 'Todos galpões' : 'Meus galpões'}</option>
            {opcoesGalpao.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}
      </div>

      {consulta.isPending ? (
        <Carregando texto="Carregando treinamentos…" />
      ) : consulta.error ? (
        <EstadoErro mensagem={mensagemErro(consulta.error)} aoTentarDeNovo={() => consulta.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          {aguardando.length > 0 && (
            <Grupo titulo="Marcar presença" qtd={aguardando.length} destaque rodape="✓ compareceu · ✕ faltou">
              {aguardando.map((t) => (
                <Linha
                  key={t.id}
                  t={t}
                  mostrarGalpao={mostrarGalpao}
                  mostrarDia
                  acao={
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setMarcando({ t, presenca: 'compareceu' })}
                        aria-label={`${t.nome ?? 'Motorista'} compareceu`}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-lg font-bold text-white active:opacity-70"
                      >
                        ✓
                      </button>
                      <button
                        type="button"
                        onClick={() => setMarcando({ t, presenca: 'faltou' })}
                        aria-label={`${t.nome ?? 'Motorista'} faltou`}
                        className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-600 text-lg font-bold text-white active:opacity-70"
                      >
                        ✕
                      </button>
                    </div>
                  }
                />
              ))}
            </Grupo>
          )}

          {aba === 'proximos' &&
            (proximos.length ? (
              porDia(proximos).map((g) => (
                <Grupo key={g.chave} titulo={g.rotulo} qtd={g.itens.length}>
                  {g.itens.map((t) => (
                    <Linha key={t.id} t={t} mostrarGalpao={mostrarGalpao} novo={novo(t)} />
                  ))}
                </Grupo>
              ))
            ) : (
              <EstadoVazio titulo="Nenhum treinamento por vir">
                Os treinamentos marcados para os próximos {DIAS_DEPOIS} dias aparecem aqui.
              </EstadoVazio>
            ))}

          {aba === 'realizados' &&
            (realizados.length ? (
              porDia(realizados).map((g) => (
                <Grupo key={g.chave} titulo={g.rotulo} qtd={g.itens.length}>
                  {g.itens.map((t) => (
                    <Linha
                      key={t.id}
                      t={t}
                      mostrarGalpao={mostrarGalpao}
                      acao={<SeloPresenca presenca={t.presenca!} />}
                      aoTocar={ehAdmin ? () => setMarcando({ t, presenca: t.presenca }) : undefined}
                    >
                      {(t.presenca_obs || t.presenca_por_nome) && (
                        <p className="col-start-2 col-end-[-1] mt-1 text-[13px] text-slate-500">
                          {t.presenca_obs ? `“${t.presenca_obs}” · ` : ''}
                          {t.presenca_por_nome ?? 'Usuário removido'}
                        </p>
                      )}
                    </Linha>
                  ))}
                </Grupo>
              ))
            ) : (
              <EstadoVazio titulo="Nenhuma presença marcada">
                Treinamentos dos últimos {DIAS_ANTES} dias com presença marcada aparecem aqui.
              </EstadoVazio>
            ))}

          {aba === 'realizados' && ehAdmin && realizados.length > 0 && (
            <p className="-mt-3 px-1 text-[13px] text-slate-500">Toque em um treinamento para corrigir a presença.</p>
          )}

          {cancelados.length > 0 && (
            <details className="group rounded-2xl bg-white">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-[15px] text-slate-500">
                Cancelados na agenda
                <span className="text-slate-400">{cancelados.length} ›</span>
              </summary>
              <ul className="divide-y divide-slate-100 border-t border-slate-100">
                {cancelados.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-[15px] text-slate-400">
                    <span className="w-24 shrink-0 tabular-nums">{rotuloDia(t.inicio).split(' · ')[1]} {hora(t.inicio)}</span>
                    <span className="min-w-0 flex-1 truncate line-through">{t.nome ?? 'Motorista'}</span>
                    <span className="text-[13px]">{t.galpao}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <ModalPresenca alvo={marcando} ehAdmin={ehAdmin} aoFechar={() => setMarcando(null)} />
    </Pagina>
  )
}

/** Lista agrupada no estilo iOS: título pequeno em cima e linhas num cartão só. */
function Grupo({
  titulo,
  qtd,
  destaque = false,
  rodape,
  children,
}: {
  titulo: string
  qtd: number
  destaque?: boolean
  rodape?: string
  children: ReactNode
}) {
  return (
    <section>
      <h2 className="mb-1.5 flex items-baseline justify-between px-4 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
        <span className={destaque ? 'text-amber-700' : undefined}>{titulo}</span>
        <span className="font-normal normal-case tracking-normal">
          {qtd} {qtd === 1 ? 'treinamento' : 'treinamentos'}
        </span>
      </h2>
      <ul
        className={`divide-y overflow-hidden rounded-2xl ${destaque ? 'divide-amber-200 bg-amber-50 ring-1 ring-amber-200' : 'divide-slate-100 bg-white'}`}
      >
        {children}
      </ul>
      {rodape && <p className="mt-1.5 px-4 text-[13px] text-slate-500">{rodape}</p>}
    </section>
  )
}

function Linha({
  t,
  mostrarGalpao,
  mostrarDia = false,
  novo = false,
  acao,
  aoTocar,
  children,
}: {
  t: Treinamento
  mostrarGalpao: boolean
  mostrarDia?: boolean
  novo?: boolean
  acao?: ReactNode
  aoTocar?: () => void
  children?: ReactNode
}) {
  const whatsapp = linkWhatsApp(t.telefone)
  const conteudo = (
    <>
      <div className="flex flex-col items-start">
        <span className="text-[17px] font-semibold tabular-nums text-slate-900">{hora(t.inicio)}</span>
        {mostrarDia && <span className="text-[12px] tabular-nums text-slate-500">{diaCurto(t.inicio)}</span>}
      </div>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5">
          <span className="truncate text-[17px] text-slate-900">{t.nome ?? 'Motorista'}</span>
          {novo && <span className="h-2 w-2 shrink-0 rounded-full bg-sky-600" aria-label="Novo" />}
        </p>
        <p className="truncate text-[13px] text-slate-500">
          {mostrarGalpao && <span className="font-semibold text-sky-700">{t.galpao}</span>}
          {mostrarGalpao && t.telefone ? ' · ' : ''}
          {t.telefone ? formatarCelular(t.telefone) : !mostrarGalpao ? 'Sem telefone' : ''}
        </p>
      </div>
      <div className="flex items-center">
        {acao ??
          (whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              aria-label={`WhatsApp de ${t.nome ?? 'motorista'}`}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 active:opacity-60"
            >
              <IconeTelefone className="h-5 w-5" />
            </a>
          ))}
      </div>
      {children}
    </>
  )
  const grade = 'grid grid-cols-[3.75rem_1fr_auto] items-center gap-x-3 px-4 py-3'
  return (
    <li>
      {aoTocar ? (
        <button type="button" onClick={aoTocar} className={`${grade} w-full text-left active:bg-slate-50`}>
          {conteudo}
        </button>
      ) : (
        <div className={grade}>{conteudo}</div>
      )}
    </li>
  )
}

function SeloPresenca({ presenca }: { presenca: Presenca }) {
  return presenca === 'compareceu' ? (
    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[13px] font-semibold text-emerald-700">Compareceu</span>
  ) : (
    <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-[13px] font-semibold text-rose-700">Faltou</span>
  )
}

function ModalPresenca({
  alvo,
  ehAdmin,
  aoFechar,
}: {
  alvo: { t: Treinamento; presenca: Presenca | null } | null
  ehAdmin: boolean
  aoFechar: () => void
}) {
  const marcar = useMarcarPresenca()
  const toast = useToast()
  const [presenca, setPresenca] = useState<Presenca | null>(null)
  const [observacao, setObservacao] = useState('')
  const [alvoAnterior, setAlvoAnterior] = useState(alvo)

  // Abriu para outro treinamento: recomeça com a escolha do botão tocado.
  if (alvo !== alvoAnterior) {
    setAlvoAnterior(alvo)
    setPresenca(alvo?.presenca ?? null)
    setObservacao(alvo?.t.presenca_obs ?? '')
  }

  function salvar(valor: Presenca | null) {
    if (!alvo) return
    marcar.mutate(
      { id: alvo.t.id, presenca: valor, observacao },
      {
        onSuccess: () => {
          toast(valor ? 'Presença registrada.' : 'Presença limpa.', 'sucesso')
          aoFechar()
        },
        onError: (e) => toast(mensagemErro(e), 'erro'),
      },
    )
  }

  const corrigindo = !!alvo?.t.presenca
  return (
    <Modal aberto={!!alvo} titulo={corrigindo ? 'Corrigir presença' : 'Presença no treinamento'} aoFechar={aoFechar}>
      {alvo && (
        <>
          <p className="text-slate-700">
            <strong>{alvo.t.nome ?? 'Motorista'}</strong> · {alvo.t.galpao} · {formatarDataHora(alvo.t.inicio)}
          </p>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Presença">
            {(['compareceu', 'faltou'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={presenca === p}
                onClick={() => setPresenca(p)}
                className={`min-h-12 rounded-xl text-[17px] font-semibold ${
                  presenca === p
                    ? p === 'compareceu'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-rose-600 text-white'
                    : 'bg-[rgb(118_118_128/0.12)] text-slate-700'
                }`}
              >
                {p === 'compareceu' ? 'Compareceu' : 'Faltou'}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="px-1 text-[13px] font-medium uppercase tracking-wide text-slate-500">Comentário (obrigatório)</span>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              maxLength={500}
              rows={3}
              required
              placeholder={
                presenca === 'faltou'
                  ? 'Motivo da falta: avisou? não atendeu? quer remarcar?'
                  : 'Como foi o treinamento: pontual, acompanhou a rota, está pronto para rodar?'
              }
              className="rounded-xl bg-white px-4 py-2.5 text-[17px] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)] placeholder:text-slate-400 focus:outline-none focus:ring-4 focus:ring-sky-100"
            />
          </label>
          {!corrigindo && <p className="text-sm text-slate-500">Depois de salvar, só o admin consegue corrigir.</p>}
          <Botao
            disabled={!presenca || observacao.trim().length < 3}
            carregando={marcar.isPending}
            onClick={() => salvar(presenca)}
          >
            Salvar
          </Botao>
          {ehAdmin && corrigindo && (
            <Botao variante="fantasma" disabled={marcar.isPending} onClick={() => salvar(null)}>
              Limpar presença
            </Botao>
          )}
        </>
      )}
    </Modal>
  )
}
