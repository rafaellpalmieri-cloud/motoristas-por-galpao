import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useAlterarStatus } from '../hooks/motoristas'
import { useSolicitar } from '../hooks/solicitacoes'
import { MOTIVOS_INATIVACAO } from '../lib/constantes'
import { mensagemErro } from '../lib/erros'
import type { Motorista } from '../lib/tipos'
import { useToast } from './Toast'
import { Botao, Modal } from './ui'

/**
 * Confirmação de inativação (com motivo) ou reativação.
 * Dispatcher não inativa direto: envia uma solicitação que o admin aprova.
 */
export function ModalStatus({ motorista, aoFechar }: { motorista: Motorista | null; aoFechar: () => void }) {
  const { ehAdmin } = useAuth()
  const titulo =
    motorista?.status !== 'ativo' ? 'Reativar motorista' : ehAdmin ? 'Inativar motorista' : 'Solicitar inativação'
  return (
    <Modal
      aberto={!!motorista}
      titulo={titulo}
      aoFechar={aoFechar}
    >
      {motorista && <Conteudo key={motorista.id} motorista={motorista} aoFechar={aoFechar} />}
    </Modal>
  )
}

function Conteudo({ motorista, aoFechar }: { motorista: Motorista; aoFechar: () => void }) {
  const { ehAdmin } = useAuth()
  const inativar = motorista.status === 'ativo'
  const solicitar = inativar && !ehAdmin
  const [motivo, setMotivo] = useState('')
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const alterar = useAlterarStatus()
  const pedir = useSolicitar()
  const toast = useToast()
  const nome = motorista.nome_completo || motorista.codigo

  function confirmar() {
    if (inativar && !motivo) return setErro('Escolha o motivo.')
    if (inativar && motivo === 'Outro' && !observacao.trim()) return setErro('Descreva o motivo na observação.')
    setErro(null)
    aoFechar()
    if (solicitar) {
      pedir.mutate(
        { motoristaId: motorista.id, motivo, observacao: observacao.trim() || undefined },
        {
          onSuccess: () => toast(`Solicitação enviada. ${nome} continua ativo até a aprovação.`, 'sucesso'),
          onError: (e) => toast(`Não foi possível solicitar: ${mensagemErro(e)}`, 'erro'),
        },
      )
      return
    }
    alterar.mutate(
      {
        motorista,
        novoStatus: inativar ? 'inativo' : 'ativo',
        motivo: inativar ? motivo : undefined,
        observacao: observacao.trim() || undefined,
      },
      {
        onSuccess: () => toast(inativar ? `${nome} foi inativado.` : `${nome} foi reativado.`, 'sucesso'),
        onError: (e) => toast(`Não foi possível salvar: ${mensagemErro(e)}`, 'erro'),
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-slate-700">
        {solicitar ? 'Solicitar a inativação de ' : inativar ? 'Confirma a inativação de ' : 'Confirma a reativação de '}
        <strong>{nome}</strong>
        {motorista.placa ? ` (${motorista.placa})` : ''}?
      </p>

      {solicitar && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          A equipe vai receber o pedido. O motorista só fica inativo depois que ela aprovar (envio para a Coopmetro e
          baixa no sistema interno).
        </p>
      )}

      {inativar && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">Motivo *</legend>
          {MOTIVOS_INATIVACAO.map((m) => (
            <label
              key={m}
              className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 ${motivo === m ? 'border-sky-600 bg-sky-50' : 'border-slate-300'}`}
            >
              <input
                type="radio"
                name="motivo"
                value={m}
                checked={motivo === m}
                onChange={() => setMotivo(m)}
                className="h-5 w-5 accent-sky-700"
              />
              {m}
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="obs" className="text-sm font-medium text-slate-700">
          Observação{inativar && motivo === 'Outro' ? ' *' : ' (opcional)'}
        </label>
        <textarea
          id="obs"
          rows={3}
          maxLength={500}
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-2 text-base focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
          placeholder={inativar ? 'Ex.: avisou que vai parar por 2 semanas' : 'Ex.: voltou a rodar'}
        />
      </div>

      {erro && <p className="text-sm text-rose-700">{erro}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Botao variante="secundario" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao variante={inativar ? 'perigo' : 'sucesso'} onClick={confirmar}>
          {solicitar ? 'Solicitar' : inativar ? 'Inativar' : 'Reativar'}
        </Botao>
      </div>
    </div>
  )
}
