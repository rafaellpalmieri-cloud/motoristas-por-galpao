import { Link } from 'react-router-dom'
import { formatarData } from '../lib/datas'
import { diasDesdeUltimaRota, nuncaRodou, parado } from '../lib/rotas'
import { formatarCelular, linkTelefone, linkWhatsApp } from '../lib/telefone'
import type { Motorista, Solicitacao } from '../lib/tipos'
import type { AlvoStatus } from './ModalStatus'
import { BadgeStatus, Botao } from './ui'

/**
 * Um card por pessoa, com todas as placas (cadastros) dela.
 * Inativar escolhe quais placas: todas (o motorista inteiro) ou só algumas.
 */
export function CardPessoa({
  placas,
  novos,
  mostrarGalpao,
  pendentes,
  cpf,
  aoAlterarStatus,
}: {
  placas: Motorista[]
  /** CPF já formatado: completo para admin, mascarado para dispatcher. */
  cpf: string | null
  novos: Set<string>
  mostrarGalpao: boolean
  pendentes: Map<string, Solicitacao>
  aoAlterarStatus: (alvo: AlvoStatus) => void
}) {
  const principal = placas.find((p) => p.status === 'ativo') ?? placas[0]
  const tel = linkTelefone(principal.celular)
  const wa = linkWhatsApp(principal.celular)
  const ativas = placas.filter((p) => p.status === 'ativo')
  const inativaveis = ativas.filter((p) => !pendentes.has(p.id))
  const inativas = placas.filter((p) => p.status === 'inativo')
  const reativaveis = inativas.filter((p) => !pendentes.has(p.id))
  const algumaAtiva = ativas.length > 0
  const varias = placas.length > 1

  return (
    <li
      className={`rounded-2xl border bg-white p-4 shadow-sm ${algumaAtiva ? 'border-slate-200' : 'border-rose-100 bg-rose-50/40'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <Link to={`/motoristas/${principal.id}`} className="min-w-0 flex-1">
          <p className={`truncate text-lg font-semibold ${algumaAtiva ? 'text-slate-900' : 'text-slate-500'}`}>
            {principal.nome_completo || '(sem nome)'}
          </p>
          <p className="text-sm text-slate-500">
            {[cpf ? `CPF ${cpf}` : 'Sem CPF', varias ? `${placas.length} placas · ${ativas.length} ativa(s)` : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </Link>
        {!varias && <BadgeStatus status={principal.status} />}
      </div>

      <ul className={`mt-2 flex flex-col ${varias ? 'divide-y divide-slate-100 rounded-xl border border-slate-200' : ''}`}>
        {placas.map((p) => (
          <LinhaPlaca
            key={p.id}
            placa={p}
            compacta={varias}
            novo={novos.has(p.id)}
            pendente={pendentes.get(p.id)}
            mostrarGalpao={mostrarGalpao}
          />
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {tel ? (
          <a
            href={tel}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 px-3 text-slate-800 hover:bg-slate-50"
            aria-label={`Ligar para ${principal.nome_completo ?? 'motorista'}`}
          >
            📞 <span className="text-sm">{formatarCelular(principal.celular)}</span>
          </a>
        ) : (
          <span className="text-sm text-slate-400">Sem celular</span>
        )}
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-xl border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            WhatsApp
          </a>
        )}
        <div className="ml-auto flex gap-2">
          {reativaveis.length > 0 && (
            <Botao variante="sucesso" onClick={() => aoAlterarStatus({ acao: 'reativar', motoristas: reativaveis })}>
              Reativar
            </Botao>
          )}
          {inativaveis.length > 0 && (
            <Botao
              variante="secundario"
              className="text-rose-700"
              onClick={() => aoAlterarStatus({ acao: 'inativar', motoristas: inativaveis })}
            >
              Inativar
            </Botao>
          )}
        </div>
      </div>
    </li>
  )
}

function LinhaPlaca({
  placa,
  compacta,
  novo,
  pendente,
  mostrarGalpao,
}: {
  placa: Motorista
  compacta: boolean
  novo: boolean
  pendente?: Solicitacao
  mostrarGalpao: boolean
}) {
  const ativo = placa.status === 'ativo'
  return (
    <li className={compacta ? 'px-3 py-2' : ''}>
      <Link to={`/motoristas/${placa.id}`} className="flex flex-wrap items-center justify-between gap-2">
        <span className={`text-sm ${ativo ? 'text-slate-700' : 'text-slate-500'}`}>
          <strong className="text-slate-900">{placa.placa ?? 'sem placa'}</strong>
          {[placa.modal, mostrarGalpao ? (placa.galpao ?? 'Sem galpão') : null]
            .filter(Boolean)
            .map((t) => ` · ${t}`)
            .join('')}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {compacta && <BadgeStatus status={placa.status} />}
          {pendente && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase text-amber-900">
              {pendente.tipo === 'reativacao' ? 'Reativação solicitada' : 'Inativação solicitada'}
            </span>
          )}
          {novo && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase text-amber-800">Novo</span>}
        </span>
      </Link>
      <LinhaRotas motorista={placa} />
      {!ativo && (placa.inativo_desde || placa.motivo_inativacao) && (
        <p className="mt-1 text-sm text-rose-700">
          Inativado{placa.inativo_desde ? ` em ${formatarData(placa.inativo_desde)}` : ''}
          {placa.motivo_inativacao ? ` · ${placa.motivo_inativacao}` : ''}
        </p>
      )}
    </li>
  )
}

/** Resumo das rotas vindo da planilha: destaca quem nunca rodou ou está parado. */
function LinhaRotas({ motorista }: { motorista: Motorista }) {
  if (nuncaRodou(motorista)) {
    return (
      <p className="mt-1">
        <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-sm font-semibold text-orange-800">Nunca fez rota</span>
      </p>
    )
  }
  if (motorista.qtd_rotas == null && !motorista.ultima_rota) return null
  const dias = diasDesdeUltimaRota(motorista.ultima_rota)
  return (
    <p className={`mt-1 text-sm ${parado(motorista) ? 'font-semibold text-amber-800' : 'text-slate-600'}`}>
      {motorista.qtd_rotas != null ? `${motorista.qtd_rotas} rota(s)` : 'Rotas'}
      {motorista.ultima_rota ? ` · última em ${formatarData(motorista.ultima_rota)}` : ''}
      {dias !== null && parado(motorista) ? ` (parado há ${dias} dias)` : ''}
    </p>
  )
}
