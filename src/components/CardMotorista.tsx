import { Link, useNavigate } from 'react-router-dom'
import { formatarData } from '../lib/datas'
import { formatarCelular, linkTelefone, linkWhatsApp } from '../lib/telefone'
import type { Motorista, Solicitacao } from '../lib/tipos'
import { BadgeStatus, Botao } from './ui'

export function CardMotorista({
  motorista,
  novo,
  mostrarGalpao,
  pendente,
  aoAlterarStatus,
}: {
  motorista: Motorista
  novo: boolean
  mostrarGalpao: boolean
  pendente?: Solicitacao
  aoAlterarStatus: (m: Motorista) => void
}) {
  const navigate = useNavigate()
  const tel = linkTelefone(motorista.celular)
  const wa = linkWhatsApp(motorista.celular)
  const ativo = motorista.status === 'ativo'

  return (
    <li
      className={`rounded-2xl border bg-white p-4 shadow-sm ${ativo ? 'border-slate-200' : 'border-rose-100 bg-rose-50/40'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <Link to={`/motoristas/${motorista.id}`} className="min-w-0 flex-1">
          <p className={`truncate text-lg font-semibold ${ativo ? 'text-slate-900' : 'text-slate-500'}`}>
            {motorista.nome_completo || '(sem nome)'}
          </p>
          <p className="text-sm text-slate-500">
            {[motorista.placa, motorista.modal, mostrarGalpao ? (motorista.galpao ?? 'Sem galpão') : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </Link>
        <div className="flex flex-col items-end gap-1">
          <BadgeStatus status={motorista.status} />
          {pendente && motorista.status === 'ativo' && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase text-amber-900">
              Inativação solicitada
            </span>
          )}
          {novo && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase text-amber-800">Novo</span>
          )}
        </div>
      </div>

      {!ativo && (motorista.inativo_desde || motorista.motivo_inativacao) && (
        <p className="mt-2 text-sm text-rose-700">
          Inativado{motorista.inativo_desde ? ` em ${formatarData(motorista.inativo_desde)}` : ''}
          {motorista.motivo_inativacao ? ` · ${motorista.motivo_inativacao}` : ''}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {tel ? (
          <a
            href={tel}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 px-3 text-slate-800 hover:bg-slate-50"
            aria-label={`Ligar para ${motorista.nome_completo ?? 'motorista'}`}
          >
            📞 <span className="text-sm">{formatarCelular(motorista.celular)}</span>
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
        {pendente && ativo ? (
          <Botao variante="secundario" className="ml-auto text-amber-800" onClick={() => navigate(`/motoristas/${motorista.id}`)}>
            Ver pedido
          </Botao>
        ) : (
          <Botao
            variante={ativo ? 'secundario' : 'sucesso'}
            className={`ml-auto ${ativo ? 'text-rose-700' : ''}`}
            onClick={() => aoAlterarStatus(motorista)}
          >
            {ativo ? 'Inativar' : 'Reativar'}
          </Botao>
        )}
      </div>
    </li>
  )
}
