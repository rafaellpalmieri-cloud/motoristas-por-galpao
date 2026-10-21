import { useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { useAlterarStatus } from '../hooks/motoristas'
import { useSolicitar } from '../hooks/solicitacoes'
import { MOTIVOS_INATIVACAO } from '../lib/constantes'
import { mensagemErro } from '../lib/erros'
import type { Motorista } from '../lib/tipos'
import { useToast } from './Toast'
import { Botao, Modal } from './ui'

export interface AlvoStatus {
  acao: 'inativar' | 'reativar'
  /** Placas (cadastros) que podem ser escolhidas; todas vêm marcadas. */
  motoristas: Motorista[]
}

/**
 * Inativar (com motivo) ou reativar uma ou mais placas do mesmo motorista.
 * Dispatcher não inativa nem reativa direto: envia um pedido que o admin aprova.
 */
export function ModalStatus({ alvo, aoFechar }: { alvo: AlvoStatus | null; aoFechar: () => void }) {
  const { ehAdmin } = useAuth()
  const reativar = alvo?.acao === 'reativar'
  const titulo = ehAdmin ? (reativar ? 'Reativar' : 'Inativar') : reativar ? 'Solicitar reativação' : 'Solicitar inativação'
  return (
    <Modal aberto={!!alvo} titulo={titulo} aoFechar={aoFechar}>
      {alvo && <Conteudo key={alvo.motoristas.map((m) => m.id).join()} alvo={alvo} aoFechar={aoFechar} />}
    </Modal>
  )
}

function Conteudo({ alvo, aoFechar }: { alvo: AlvoStatus; aoFechar: () => void }) {
  const { ehAdmin } = useAuth()
  const inativar = alvo.acao === 'inativar'
  const solicitar = !ehAdmin
  const [marcados, setMarcados] = useState<string[]>(alvo.motoristas.map((m) => m.id))
  const [motivo, setMotivo] = useState('')
  const [observacao, setObservacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const alterar = useAlterarStatus()
  const pedir = useSolicitar()
  const toast = useToast()

  const varias = alvo.motoristas.length > 1
  const escolhidos = alvo.motoristas.filter((m) => marcados.includes(m.id))
  const nome = alvo.motoristas[0].nome_completo || alvo.motoristas[0].codigo
  const todas = escolhidos.length === alvo.motoristas.length
  const resumo = varias ? (todas ? 'todas as placas' : `${escolhidos.length} placa(s)`) : (alvo.motoristas[0].placa ?? 'placa')

  function confirmar() {
    if (!escolhidos.length) return setErro('Escolha ao menos uma placa.')
    if (inativar && !motivo) return setErro('Escolha o motivo.')
    if (inativar && motivo === 'Outro' && !observacao.trim()) return setErro('Descreva o motivo na observação.')
    setErro(null)
    aoFechar()
    const obs = observacao.trim() || undefined
    if (solicitar) {
      pedir.mutate(
        {
          tipo: inativar ? 'inativacao' : 'reativacao',
          motoristaIds: escolhidos.map((m) => m.id),
          motivo: inativar ? motivo : undefined,
          observacao: obs,
        },
        {
          onSuccess: () =>
            toast(
              `Pedido enviado (${nome}, ${resumo}). Continua ${inativar ? 'ativo' : 'inativo'} até a aprovação.`,
              'sucesso',
            ),
          onError: (e) => toast(`Não foi possível solicitar: ${mensagemErro(e)}`, 'erro'),
        },
      )
      return
    }
    alterar.mutate(
      {
        motoristas: escolhidos,
        novoStatus: inativar ? 'inativo' : 'ativo',
        motivo: inativar ? motivo : undefined,
        observacao: obs,
      },
      {
        onSuccess: () => toast(`${nome}: ${resumo} ${inativar ? 'inativada(s)' : 'reativada(s)'}.`, 'sucesso'),
        onError: (e) => toast(`Não foi possível salvar: ${mensagemErro(e)}`, 'erro'),
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-slate-700">
        <strong>{nome}</strong>
        {varias
          ? inativar
            ? ' — marque as placas que vão sair. Deixe todas marcadas para inativar o motorista inteiro.'
            : ' — marque as placas que vão voltar a rodar.'
          : alvo.motoristas[0].placa
            ? ` (${alvo.motoristas[0].placa})`
            : ''}
      </p>

      {varias && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">Placas</legend>
          {alvo.motoristas.map((m) => {
            const marcado = marcados.includes(m.id)
            return (
              <label
                key={m.id}
                className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 ${marcado ? 'border-sky-600 bg-sky-50' : 'border-slate-300'}`}
              >
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => setMarcados((atual) => (marcado ? atual.filter((x) => x !== m.id) : [...atual, m.id]))}
                  className="h-5 w-5 accent-sky-700"
                />
                <span className="font-semibold">{m.placa ?? 'sem placa'}</span>
                <span className="text-sm text-slate-500">{[m.modal, m.galpao, m.codigo].filter(Boolean).join(' · ')}</span>
              </label>
            )
          })}
        </fieldset>
      )}

      {solicitar && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          {inativar
            ? 'A equipe vai receber o pedido. As placas só ficam inativas depois que ela aprovar (envio para a Coopmetro e baixa no sistema interno).'
            : 'A equipe vai receber o pedido. As placas só voltam a ficar ativas depois que ela aprovar (Coopmetro e sistema interno).'}
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
          placeholder={inativar ? 'Ex.: vendeu o carro; continua rodando de moto' : 'Ex.: voltou a rodar'}
        />
      </div>

      {erro && <p className="text-sm text-rose-700">{erro}</p>}

      <div className="grid grid-cols-2 gap-3">
        <Botao variante="secundario" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao variante={inativar ? 'perigo' : 'sucesso'} onClick={confirmar}>
          {solicitar ? 'Enviar pedido' : inativar ? 'Inativar' : 'Reativar'}
        </Botao>
      </div>
    </div>
  )
}
