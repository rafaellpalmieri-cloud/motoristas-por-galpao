import { useState } from 'react'
import { useAlterarStatus } from '../hooks/motoristas'
import { MOTIVOS_INATIVACAO } from '../lib/constantes'
import { mensagemErro } from '../lib/erros'
import type { Motorista } from '../lib/tipos'
import { useToast } from './Toast'
import { Botao, Modal } from './ui'

/** Confirmação de inativação (com motivo) ou reativação. */
export function ModalStatus({ motorista, aoFechar }: { motorista: Motorista | null; aoFechar: () => void }) {
  return (
    <Modal
      aberto={!!motorista}
      titulo={motorista?.status === 'ativo' ? 'Inativar motorista' : 'Reativar motorista'}
      aoFechar={aoFechar}
    >
      {motorista && <Conteudo key={motorista.id} motorista={motorista} aoFechar={aoFechar} />}
    </Modal>
  )
}

function Conteudo({ motorista, aoFechar }: { motorista: Motorista; aoFechar: () => void }) {
  const inativar = motorista.status === 'ativo'
  const [motivo, setMotivo] = useState('')
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const alterar = useAlterarStatus()
  const toast = useToast()
  const nome = motorista.nome_completo || motorista.codigo

  function confirmar() {
    if (inativar && !motivo) return setErro('Escolha o motivo.')
    if (inativar && motivo === 'Outro' && !observacao.trim()) return setErro('Descreva o motivo na observação.')
    setErro(null)
    aoFechar()
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
        {inativar ? 'Confirma a inativação de ' : 'Confirma a reativação de '}
        <strong>{nome}</strong>
        {motorista.placa ? ` (${motorista.placa})` : ''}?
      </p>

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
          {inativar ? 'Inativar' : 'Reativar'}
        </Botao>
      </div>
    </div>
  )
}
