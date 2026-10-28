import { useState } from 'react'
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

function dia(iso: string) {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone: fuso })
}

function hora(iso: string) {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
}

/** "Hoje", "Amanhã" ou "quinta-feira, 30/10". */
function rotuloDia(iso: string) {
  const d = dia(iso)
  const hoje = dia(new Date().toISOString())
  const amanha = dia(new Date(Date.now() + 864e5).toISOString())
  if (d === hoje) return 'Hoje'
  if (d === amanha) return 'Amanhã'
  return new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(iso))
}

/** Agrupa em ordem pelo dia do treinamento. */
function porDia(itens: Treinamento[]) {
  const grupos: { rotulo: string; itens: Treinamento[] }[] = []
  for (const t of itens) {
    const rotulo = rotuloDia(t.inicio)
    const ultimo = grupos[grupos.length - 1]
    if (ultimo?.rotulo === rotulo) ultimo.itens.push(t)
    else grupos.push({ rotulo, itens: [t] })
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
  const consulta = useTreinamentos()
  const lidos = useAlertasLidos()
  const [marcando, setMarcando] = useState<{ t: Treinamento; presenca: Presenca | null } | null>(null)

  const opcoesGalpao = ehAdmin ? [...GALPOES] : (usuario?.galpoes ?? [])
  const agora = useAgora()
  const todos = (consulta.data ?? []).filter((t) => !galpao || t.galpao === galpao)
  const ativos = todos.filter((t) => t.status === 'agendado')
  const aguardando = ativos.filter((t) => !t.presenca && new Date(t.inicio).getTime() <= agora)
  const proximos = ativos.filter((t) => new Date(t.inicio).getTime() > agora)
  const realizados = ativos.filter((t) => t.presenca).reverse()
  const cancelados = todos.filter((t) => t.status === 'cancelado')

  const novo = (t: Treinamento) => !ehAdmin && !!lidos.data && !lidos.data.has(chaveAlerta.treinamento(t.id))

  return (
    <Pagina titulo="Treinamentos">
      <p className="mb-3 text-slate-600">
        Marcados pela equipe de cadastro. Depois do horário, marque se o motorista compareceu.
      </p>

      {(ehAdmin || opcoesGalpao.length > 1) && (
        <select
          value={galpao}
          onChange={(e) => setParams(e.target.value ? { galpao: e.target.value } : {}, { replace: true })}
          aria-label="Filtrar por galpão"
          className="mb-4 min-h-12 w-full rounded-xl border border-black/5 bg-white px-3 text-base font-medium"
        >
          <option value="">{ehAdmin ? 'Todos os galpões' : 'Meus galpões'}</option>
          {opcoesGalpao.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      )}

      {consulta.isPending ? (
        <Carregando texto="Carregando treinamentos…" />
      ) : consulta.error ? (
        <EstadoErro mensagem={mensagemErro(consulta.error)} aoTentarDeNovo={() => consulta.refetch()} />
      ) : !todos.length ? (
        <EstadoVazio titulo="Nenhum treinamento">
          Nada marcado entre {DIAS_ANTES} dias atrás e os próximos {DIAS_DEPOIS} dias.
        </EstadoVazio>
      ) : (
        <div className="flex flex-col gap-6">
          {aguardando.length > 0 && (
            <Secao titulo={`Marcar presença (${aguardando.length})`}>
              {aguardando.map((t) => (
                <CartaoTreinamento key={t.id} t={t} destaque mostrarDia>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Botao variante="sucesso" onClick={() => setMarcando({ t, presenca: 'compareceu' })}>
                      Compareceu
                    </Botao>
                    <Botao variante="perigo" onClick={() => setMarcando({ t, presenca: 'faltou' })}>
                      Faltou
                    </Botao>
                  </div>
                </CartaoTreinamento>
              ))}
            </Secao>
          )}

          {proximos.length > 0 &&
            porDia(proximos).map((g) => (
              <Secao key={g.rotulo} titulo={g.rotulo}>
                {g.itens.map((t) => (
                  <CartaoTreinamento key={t.id} t={t} novo={novo(t)} />
                ))}
              </Secao>
            ))}

          {!proximos.length && !aguardando.length && (
            <EstadoVazio titulo="Nenhum treinamento por vir">Os próximos treinamentos aparecem aqui assim que forem marcados.</EstadoVazio>
          )}

          {realizados.length > 0 && (
            <Secao titulo="Realizados">
              {realizados.map((t) => (
                <CartaoTreinamento key={t.id} t={t} mostrarDia>
                  <ResultadoPresenca t={t} />
                  {ehAdmin && (
                    <button
                      type="button"
                      onClick={() => setMarcando({ t, presenca: t.presenca === 'faltou' ? 'compareceu' : 'faltou' })}
                      className="mt-2 min-h-11 text-sm font-semibold text-sky-700"
                    >
                      Corrigir presença
                    </button>
                  )}
                </CartaoTreinamento>
              ))}
            </Secao>
          )}

          {cancelados.length > 0 && (
            <details className="rounded-2xl bg-white p-4">
              <summary className="min-h-11 cursor-pointer font-semibold text-slate-600">Cancelados ({cancelados.length})</summary>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-500">
                {cancelados.map((t) => (
                  <li key={t.id} className="line-through">
                    {formatarDataHora(t.inicio)} · {t.nome ?? 'Motorista'} · {t.galpao}
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

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-slate-500 first-letter:uppercase">{titulo}</h2>
      <ul className="flex flex-col gap-3">{children}</ul>
    </section>
  )
}

function CartaoTreinamento({
  t,
  destaque = false,
  novo = false,
  mostrarDia = false,
  children,
}: {
  t: Treinamento
  destaque?: boolean
  novo?: boolean
  mostrarDia?: boolean
  children?: React.ReactNode
}) {
  const whatsapp = linkWhatsApp(t.telefone)
  return (
    <li className={`rounded-2xl p-4 ${destaque ? 'border border-amber-300 bg-amber-50' : 'bg-white'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-sky-700">
            {mostrarDia ? `${rotuloDia(t.inicio)} · ` : ''}
            {hora(t.inicio)} · {t.galpao}
          </p>
          <p className="mt-0.5 font-semibold text-slate-900">{t.nome ?? 'Motorista'}</p>
          {t.telefone && <p className="text-sm text-slate-500">{formatarCelular(t.telefone)}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {novo && <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-bold uppercase text-amber-900">Novo</span>}
          {whatsapp && (
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`WhatsApp de ${t.nome ?? 'motorista'}`}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"
            >
              <IconeTelefone className="h-5 w-5" />
            </a>
          )}
        </div>
      </div>
      {children}
    </li>
  )
}

function ResultadoPresenca({ t }: { t: Treinamento }) {
  const compareceu = t.presenca === 'compareceu'
  return (
    <div className="mt-2">
      <span
        className={`inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${compareceu ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}
      >
        {compareceu ? 'Compareceu' : 'Faltou'}
      </span>
      {t.presenca_obs && <p className="mt-1 text-sm text-slate-600">“{t.presenca_obs}”</p>}
      <p className="mt-1 text-xs text-slate-500">
        {t.presenca_por_nome ?? 'Usuário removido'} · {formatarDataHora(t.presenca_em)}
      </p>
    </div>
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
            <span className="px-1 text-[13px] font-medium uppercase tracking-wide text-slate-500">Observação (opcional)</span>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              maxLength={500}
              rows={3}
              className="rounded-xl bg-white px-4 py-2.5 text-[17px] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)] focus:outline-none focus:ring-4 focus:ring-sky-100"
            />
          </label>
          {!corrigindo && <p className="text-sm text-slate-500">Depois de salvar, só o admin consegue corrigir.</p>}
          <Botao disabled={!presenca} carregando={marcar.isPending} onClick={() => salvar(presenca)}>
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
