import { useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ModalStatus } from '../components/ModalStatus'
import { BadgeStatus, Botao, Carregando, Cartao, EstadoErro, EstadoVazio, Pagina, SeloPlanilha } from '../components/ui'
import { CartaoSolicitacao } from '../components/CartaoSolicitacao'
import { useHistorico, useMotorista } from '../hooks/motoristas'
import { useSolicitacoesDoMotorista } from '../hooks/solicitacoes'
import { formatarData, formatarDataHora } from '../lib/datas'
import { mensagemErro } from '../lib/erros'
import { formatarCelular, linkTelefone, linkWhatsApp } from '../lib/telefone'
import type { Motorista } from '../lib/tipos'

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <dt className="text-slate-500">{rotulo}</dt>
      <dd className="text-right font-medium text-slate-900">{children || '—'}</dd>
    </div>
  )
}

export default function MotoristaDetalhe() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const motorista = useMotorista(id)
  const historico = useHistorico(id)
  const solicitacoes = useSolicitacoesDoMotorista(id)
  const [selecionado, setSelecionado] = useState<Motorista | null>(null)

  const voltar = (
    <button
      type="button"
      // Volta preservando busca e filtros; se abriu o link direto, vai para a lista.
      onClick={() => (location.key !== 'default' ? navigate(-1) : navigate('/'))}
      className="flex min-h-11 items-center px-2 text-sm font-medium text-sky-800"
    >
      ← Voltar
    </button>
  )

  if (motorista.isPending) return <Carregando />
  if (motorista.error)
    return (
      <Pagina titulo="Motorista" acao={voltar}>
        <EstadoErro mensagem={mensagemErro(motorista.error)} aoTentarDeNovo={() => motorista.refetch()} />
      </Pagina>
    )
  const m = motorista.data
  if (!m)
    return (
      <Pagina titulo="Motorista" acao={voltar}>
        <EstadoVazio titulo="Motorista não encontrado">Ele pode ter sido removido ou não pertence aos seus galpões.</EstadoVazio>
      </Pagina>
    )

  const pedidoPendente = solicitacoes.data?.find((s) => s.status === 'pendente')
  const ultimosPedidos = (solicitacoes.data ?? []).filter((s) => s.status !== 'pendente').slice(0, 5)
  const tel = linkTelefone(m.celular)
  const wa = linkWhatsApp(m.celular)

  return (
    <Pagina titulo="Motorista" acao={voltar}>
      <Cartao className="mb-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">{m.nome_completo || '(sem nome)'}</h2>
          <BadgeStatus status={m.status} />
        </div>
        <dl className="text-sm">
          <Linha rotulo="Código">{m.codigo}</Linha>
          <Linha rotulo="Placa">{m.placa}</Linha>
          <Linha rotulo="Modal">{m.modal}</Linha>
          <Linha rotulo="Galpão">{m.galpao ?? 'Sem galpão'}</Linha>
          <Linha rotulo="Celular">{formatarCelular(m.celular)}</Linha>
          {m.status === 'inativo' && <Linha rotulo="Inativo desde">{formatarData(m.inativo_desde)}</Linha>}
          {m.status === 'inativo' && <Linha rotulo="Motivo">{m.motivo_inativacao}</Linha>}
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {tel && (
            <a href={tel} className="flex min-h-11 items-center justify-center rounded-xl border border-slate-300 font-semibold text-slate-800">
              📞 Ligar
            </a>
          )}
          {wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-11 items-center justify-center rounded-xl border border-emerald-300 bg-emerald-50 font-semibold text-emerald-800"
            >
              WhatsApp
            </a>
          )}
          {!(pedidoPendente && m.status === 'ativo') && (
            <Botao variante={m.status === 'ativo' ? 'perigo' : 'sucesso'} className="col-span-2" onClick={() => setSelecionado(m)}>
              {m.status === 'ativo' ? 'Inativar' : 'Reativar'}
            </Botao>
          )}
        </div>
      </Cartao>

      {pedidoPendente && m.status === 'ativo' && (
        <div className="mb-4">
          <CartaoSolicitacao s={pedidoPendente} mostrarMotorista={false} />
        </div>
      )}

      {ultimosPedidos.length > 0 && (
        <details className="mb-4 rounded-2xl border border-slate-200 bg-white">
          <summary className="min-h-11 cursor-pointer px-4 py-3 font-semibold text-slate-800">
            Pedidos anteriores ({ultimosPedidos.length})
          </summary>
          <div className="flex flex-col gap-2 px-3 pb-3">
            {ultimosPedidos.map((s) => (
              <CartaoSolicitacao key={s.id} s={s} mostrarMotorista={false} />
            ))}
          </div>
        </details>
      )}

      <h2 className="mb-2 text-lg font-bold text-slate-900">Histórico</h2>
      {historico.isPending ? (
        <Carregando texto="Carregando histórico…" />
      ) : historico.error ? (
        <EstadoErro mensagem={mensagemErro(historico.error)} aoTentarDeNovo={() => historico.refetch()} />
      ) : historico.data.length === 0 ? (
        <EstadoVazio titulo="Sem alterações registradas" />
      ) : (
        <ol className="flex flex-col gap-3">
          {historico.data.map((h) => (
            <li key={h.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {h.status_anterior && <BadgeStatus status={h.status_anterior} />}
                <span aria-hidden>→</span>
                <BadgeStatus status={h.status_novo} />
                {h.origem === 'planilha' && <SeloPlanilha />}
              </div>
              {h.motivo && <p className="mt-2 font-medium text-slate-800">{h.motivo}</p>}
              {h.observacao && <p className="mt-1 text-slate-600">“{h.observacao}”</p>}
              <p className="mt-2 text-sm text-slate-500">
                {h.alterado_por_nome ?? 'Usuário removido'} · {formatarDataHora(h.alterado_em)}
                {h.galpao ? ` · ${h.galpao}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}

      <ModalStatus motorista={selecionado} aoFechar={() => setSelecionado(null)} />
    </Pagina>
  )
}
