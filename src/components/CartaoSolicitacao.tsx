import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { useCancelarSolicitacao, useDecidirSolicitacao } from '../hooks/solicitacoes'
import { formatarDataHora, tempoRelativo } from '../lib/datas'
import { mensagemErro } from '../lib/erros'
import { linkWhatsApp } from '../lib/telefone'
import type { Solicitacao, StatusSolicitacao } from '../lib/tipos'
import { useToast } from './Toast'
import { Botao, Modal } from './ui'

const ROTULOS: Record<StatusSolicitacao, [string, string]> = {
  pendente: ['Aguardando aprovação', 'bg-amber-100 text-amber-900'],
  aprovada: ['Aprovada', 'bg-rose-50 text-rose-700'],
  recusada: ['Recusada', 'bg-slate-200 text-slate-700'],
  cancelada: ['Cancelada', 'bg-slate-100 text-slate-500'],
}

export function SeloSolicitacao({ status }: { status: StatusSolicitacao }) {
  const [rotulo, cor] = ROTULOS[status]
  return <span className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase ${cor}`}>{rotulo}</span>
}

/**
 * Pedido de inativação ou reativação (uma ou várias placas do mesmo motorista,
 * mesmo grupo) com as ações permitidas para quem está vendo.
 */
export function CartaoSolicitacao({ itens, mostrarMotorista = true }: { itens: Solicitacao[]; mostrarMotorista?: boolean }) {
  const { ehAdmin, session } = useAuth()
  const [modal, setModal] = useState<'aprovar' | 'recusar' | 'cancelar' | null>(null)
  const s = itens[0]
  const reativar = s.tipo === 'reativacao'
  const tipoPedido = reativar ? 'reativação' : 'inativação'
  const pendentes = itens.filter((i) => i.status === 'pendente')
  const pendente = pendentes.length > 0
  const podeCancelar = pendente && (ehAdmin || s.solicitado_por === session?.user.id)
  const nome = s.motoristas?.nome_completo || s.motoristas?.codigo || 'Motorista'
  const wa = linkWhatsApp(s.motoristas?.celular ?? null)
  const varias = itens.length > 1
  const placas = itens.map((i) => i.motoristas?.placa ?? i.motoristas?.codigo ?? '?')

  return (
    <div className={`rounded-2xl border p-4 ${pendente ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-2">
        {mostrarMotorista ? (
          <Link to={`/motoristas/${s.motorista_id}`} className="min-w-0 font-semibold text-slate-900">
            {nome}
            <span className="font-normal text-slate-500"> · {varias ? `${itens.length} placas` : placas[0]}</span>
          </Link>
        ) : (
          <p className="font-semibold text-slate-900">
            Pedido de {tipoPedido}
            {varias ? ` (${itens.length} placas)` : ''}
          </p>
        )}
        <SeloSolicitacao status={pendente ? 'pendente' : s.status} />
      </div>

      {varias && (
        <ul className="mt-2 flex flex-wrap gap-1">
          {itens.map((i) => (
            <li key={i.id}>
              <Link
                to={`/motoristas/${i.motorista_id}`}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-sm font-semibold"
              >
                {i.motoristas?.placa ?? i.motoristas?.codigo}
                {i.status !== 'pendente' && <span className="text-xs font-normal text-slate-500">({ROTULOS[i.status][0]})</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className={`mt-2 ${reativar ? 'text-emerald-700' : 'text-rose-700'}`}>
        {reativar ? 'Pedido de reativação' : s.motivo}
        {s.galpao ? ` · ${s.galpao}` : ''}
      </p>
      {s.observacao && <p className="mt-1 text-sm text-slate-600">“{s.observacao}”</p>}
      <p className="mt-2 text-sm text-slate-500">
        Pedido por {s.solicitado_por_nome ?? 'usuário removido'} · {formatarDataHora(s.solicitado_em)} (
        {tempoRelativo(s.solicitado_em)})
      </p>
      {!pendente && s.decidido_em && (
        <p className="mt-1 text-sm text-slate-500">
          {ROTULOS[s.status][0]} por {s.decidido_por_nome ?? '—'} · {formatarDataHora(s.decidido_em)}
          {s.resposta ? ` — “${s.resposta}”` : ''}
        </p>
      )}

      {(pendente && (ehAdmin || podeCancelar)) || (mostrarMotorista && wa) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {mostrarMotorista && wa && (
            <a
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-xl border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800"
            >
              WhatsApp do motorista
            </a>
          )}
          {pendente && ehAdmin && (
            <>
              <Botao variante={reativar ? 'sucesso' : 'perigo'} onClick={() => setModal('aprovar')}>
                Aprovar {tipoPedido}
              </Botao>
              <Botao variante="secundario" onClick={() => setModal('recusar')}>
                Recusar
              </Botao>
            </>
          )}
          {podeCancelar && !ehAdmin && (
            <Botao variante="secundario" onClick={() => setModal('cancelar')}>
              Cancelar pedido
            </Botao>
          )}
        </div>
      ) : null}

      <Modal
        aberto={!!modal}
        titulo={modal === 'aprovar' ? `Aprovar ${tipoPedido}` : modal === 'recusar' ? 'Recusar pedido' : 'Cancelar pedido'}
        aoFechar={() => setModal(null)}
      >
        {modal && (
          <Decisao
            key={modal}
            s={pendentes[0] ?? s}
            nome={nome}
            placas={pendentes.map((i) => i.motoristas?.placa ?? i.motoristas?.codigo ?? '?')}
            acao={modal}
            aoFechar={() => setModal(null)}
          />
        )}
      </Modal>
    </div>
  )
}

function Decisao({
  s,
  nome,
  placas,
  acao,
  aoFechar,
}: {
  s: Solicitacao
  nome: string
  placas: string[]
  acao: 'aprovar' | 'recusar' | 'cancelar'
  aoFechar: () => void
}) {
  const [confirmado, setConfirmado] = useState(false)
  const [resposta, setResposta] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const decidir = useDecidirSolicitacao()
  const cancelar = useCancelarSolicitacao()
  const toast = useToast()
  const carregando = decidir.isPending || cancelar.isPending
  const qual = placas.length > 1 ? `as ${placas.length} placas (${placas.join(', ')})` : `a placa ${placas[0]}`
  const reativar = s.tipo === 'reativacao'

  function confirmar() {
    if (acao === 'aprovar' && !confirmado) {
      return setErro(
        reativar
          ? 'Confirme que já reativou na Coopmetro e no sistema interno.'
          : 'Confirme que já fez a baixa na Coopmetro e no sistema interno.',
      )
    }
    if (acao === 'recusar' && !resposta.trim()) return setErro('Explique o motivo da recusa para o dispatcher.')
    setErro(null)
    const opcoes = {
      onSuccess: () => {
        toast(
          acao === 'aprovar'
            ? `${nome}: ${reativar ? 'reativado(s)' : 'inativado(s)'}.`
            : acao === 'recusar'
              ? 'Pedido recusado.'
              : 'Pedido cancelado.',
          'sucesso',
        )
        aoFechar()
      },
      onError: (e: unknown) => setErro(mensagemErro(e)),
    }
    if (acao === 'cancelar') cancelar.mutate(s, opcoes)
    else decidir.mutate({ s, aprovar: acao === 'aprovar', resposta: resposta.trim() || undefined }, opcoes)
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-slate-700">
        {acao === 'aprovar' &&
          (reativar ? (
            <>
              <strong>{nome}</strong>: {qual} {placas.length > 1 ? 'voltarão' : 'voltará'} a ficar <strong>ativa(s)</strong>.
            </>
          ) : (
            <>
              <strong>{nome}</strong>: {qual} {placas.length > 1 ? 'ficarão' : 'ficará'} <strong>inativa(s)</strong> (motivo:{' '}
              {s.motivo}).
            </>
          ))}
        {acao === 'recusar' && (
          <>
            <strong>{nome}</strong> continua {reativar ? 'inativo' : 'ativo'}. O dispatcher verá a sua resposta.
          </>
        )}
        {acao === 'cancelar' && (
          <>
            O pedido de {reativar ? 'reativação' : 'inativação'} de <strong>{nome}</strong> ({qual}) será cancelado.
          </>
        )}
      </p>

      {acao === 'aprovar' && (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-slate-300 p-3">
          <input
            type="checkbox"
            checked={confirmado}
            onChange={(e) => setConfirmado(e.target.checked)}
            className="mt-0.5 h-5 w-5 accent-rose-600"
          />
          <span className="text-sm text-slate-800">
            {reativar
              ? 'Já reativei na Coopmetro e no nosso sistema interno.'
              : 'Já enviei para a Coopmetro e inativei no nosso sistema interno.'}
          </span>
        </label>
      )}

      {acao !== 'cancelar' && (
        <div className="flex flex-col gap-1">
          <label htmlFor="resposta" className="text-sm font-medium text-slate-700">
            {acao === 'recusar' ? 'Motivo da recusa *' : 'Comentário (opcional)'}
          </label>
          <textarea
            id="resposta"
            rows={3}
            maxLength={500}
            value={resposta}
            onChange={(e) => setResposta(e.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-base focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
            placeholder={
              acao === 'recusar'
                ? reativar
                  ? 'Ex.: documentação ainda pendente'
                  : 'Ex.: motorista fez rota ontem, confirmar antes'
                : 'Ex.: enviado na planilha da Coopmetro'
            }
          />
        </div>
      )}

      {erro && <p className="text-sm text-rose-700">{erro}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Botao variante="secundario" onClick={aoFechar}>
          Voltar
        </Botao>
        <Botao
          variante={acao === 'aprovar' ? (reativar ? 'sucesso' : 'perigo') : 'primario'}
          carregando={carregando}
          onClick={confirmar}
        >
          {acao === 'aprovar' ? 'Aprovar' : acao === 'recusar' ? 'Recusar' : 'Cancelar pedido'}
        </Botao>
      </div>
    </div>
  )
}
