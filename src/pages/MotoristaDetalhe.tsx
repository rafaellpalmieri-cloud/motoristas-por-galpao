import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { IconeTelefone } from '../components/Icones'
import { ModalStatus, type AlvoStatus } from '../components/ModalStatus'
import { ehPausado } from '../lib/pausados'
import { BadgeStatus, Botao, Carregando, Cartao, EstadoErro, EstadoVazio, Pagina, SeloPlanilha } from '../components/ui'
import { CartaoSolicitacao } from '../components/CartaoSolicitacao'
import { useAuth } from '../auth/AuthProvider'
import { useCpfCompleto, useHistorico, useMotorista, useMotoristas } from '../hooks/motoristas'
import { useSolicitacoesDoMotorista } from '../hooks/solicitacoes'
import { formatarData, formatarDataHora } from '../lib/datas'
import { mensagemErro } from '../lib/erros'
import { formatarCpf, nuncaRodou } from '../lib/rotas'
import { formatarCelular, linkTelefone, linkWhatsApp } from '../lib/telefone'

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
  const { ehAdmin } = useAuth()
  const cpfCompleto = useCpfCompleto(id, ehAdmin)
  const [alvo, setAlvo] = useState<AlvoStatus | null>(null)
  const { data: todos } = useMotoristas()

  const voltar = (
    <button
      type="button"
      // Volta preservando busca e filtros; se abriu o link direto, vai para a lista.
      onClick={() => (location.key !== 'default' ? navigate(-1) : navigate('/motoristas'))}
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

  const outrasPlacas = (todos ?? []).filter((p) => p.pessoa_id && p.pessoa_id === m.pessoa_id && p.id !== m.id)
  const pedidoPendente = solicitacoes.data?.find((s) => s.status === 'pendente')
  const ultimosPedidos = (solicitacoes.data ?? []).filter((s) => s.status !== 'pendente').slice(0, 5)
  const tel = linkTelefone(m.celular)
  const wa = linkWhatsApp(m.celular)

  return (
    <Pagina titulo="Motorista" acao={voltar}>
      <Cartao className="mb-4">
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-slate-900">{m.nome_completo || '(sem nome)'}</h2>
          <BadgeStatus status={m.status} pausado={ehPausado(m)} />
        </div>
        <dl className="text-sm">
          <Linha rotulo="Código">{m.codigo}</Linha>
          <Linha rotulo="Placa">{m.placa}</Linha>
          <Linha rotulo="Modal">{m.modal}</Linha>
          <Linha rotulo="Galpão">{m.galpao ?? 'Sem galpão'}</Linha>
          <Linha rotulo="Celular">{formatarCelular(m.celular)}</Linha>
          <Linha rotulo="CPF">{ehAdmin && cpfCompleto.data ? formatarCpf(cpfCompleto.data) : m.cpf_mascarado}</Linha>
          <Linha rotulo="Fez rota?">{nuncaRodou(m) ? 'Não' : 'Sim'}</Linha>
          <Linha rotulo="Qtd. de rotas">{m.qtd_rotas != null ? String(m.qtd_rotas) : ''}</Linha>
          <Linha rotulo="Última rota">{formatarData(m.ultima_rota)}</Linha>
          {m.status === 'inativo' && <Linha rotulo="Inativo desde">{formatarData(m.inativo_desde)}</Linha>}
          {m.status === 'inativo' && <Linha rotulo="Motivo">{m.motivo_inativacao}</Linha>}
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {tel && (
            <a href={tel} className="flex min-h-11 items-center justify-center rounded-xl border border-slate-300 font-semibold text-slate-800">
              <IconeTelefone className="mr-1.5 h-5 w-5 text-sky-600" /> Ligar
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
          {!pedidoPendente && (
            <Botao variante={m.status === 'ativo' ? 'perigo' : 'sucesso'} className="col-span-2" onClick={() => setAlvo({ acao: m.status === 'ativo' ? 'inativar' : 'reativar', motoristas: [m] })}>
              {m.status === 'ativo' ? 'Inativar' : 'Reativar'}
            </Botao>
          )}
        </div>
      </Cartao>

      {outrasPlacas.length > 0 && (
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4">
          <p className="mb-2 font-semibold text-slate-800">Outras placas deste motorista</p>
          <ul className="flex flex-col gap-2">
            {outrasPlacas.map((p) => (
              <li key={p.id}>
                <Link to={`/motoristas/${p.id}`} className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-slate-200 px-3">
                  <span className="text-sm">
                    <strong>{p.placa ?? 'sem placa'}</strong>
                    {[p.modal, p.galpao, p.codigo].filter(Boolean).map((t) => ` · ${t}`).join('')}
                  </span>
                  <BadgeStatus status={p.status} pausado={ehPausado(p)} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pedidoPendente && (
        <div className="mb-4">
          <CartaoSolicitacao itens={[pedidoPendente]} mostrarMotorista={false} />
        </div>
      )}

      {ultimosPedidos.length > 0 && (
        <details className="mb-4 rounded-2xl border border-slate-200 bg-white">
          <summary className="min-h-11 cursor-pointer px-4 py-3 font-semibold text-slate-800">
            Pedidos anteriores ({ultimosPedidos.length})
          </summary>
          <div className="flex flex-col gap-2 px-3 pb-3">
            {ultimosPedidos.map((s) => (
              <CartaoSolicitacao key={s.id} itens={[s]} mostrarMotorista={false} />
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

      <ModalStatus alvo={alvo} aoFechar={() => setAlvo(null)} />
    </Pagina>
  )
}
