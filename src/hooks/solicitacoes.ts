import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Solicitacao } from '../lib/tipos'

const CAMPOS = '*, motoristas(nome_completo, placa, codigo, celular)'

function invalidarTudo(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ['solicitacoes'] })
  queryClient.invalidateQueries({ queryKey: ['motoristas'] })
  queryClient.invalidateQueries({ queryKey: ['motorista'] })
  queryClient.invalidateQueries({ queryKey: ['historico'] })
  queryClient.invalidateQueries({ queryKey: ['alertas'] })
  queryClient.invalidateQueries({ queryKey: ['resumo'] })
}

/** Solicitações pendentes visíveis ao usuário (a RLS limita aos galpões dele). */
export function usePendentes() {
  return useQuery({
    queryKey: ['solicitacoes', 'pendentes'],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('solicitacoes_inativacao')
        .select(CAMPOS)
        .eq('status', 'pendente')
        .order('solicitado_em', { ascending: true })
        .limit(1000)
      if (error) throw error
      return data as Solicitacao[]
    },
  })
}

/** Solicitações já decididas ou canceladas nos últimos 30 dias. */
export function useDecididas() {
  return useQuery({
    queryKey: ['solicitacoes', 'decididas'],
    queryFn: async () => {
      const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      const { data, error } = await supabase
        .from('solicitacoes_inativacao')
        .select(CAMPOS)
        .neq('status', 'pendente')
        .gte('solicitado_em', desde)
        .order('decidido_em', { ascending: false })
        .limit(300)
      if (error) throw error
      return data as Solicitacao[]
    },
  })
}

export function useSolicitacoesDoMotorista(motoristaId: string | undefined) {
  return useQuery({
    queryKey: ['solicitacoes', 'motorista', motoristaId],
    enabled: !!motoristaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('solicitacoes_inativacao')
        .select('*')
        .eq('motorista_id', motoristaId!)
        .order('solicitado_em', { ascending: false })
        .limit(20)
      if (error) throw error
      return data as Solicitacao[]
    },
  })
}

export function useSolicitar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { motoristaId: string; motivo: string; observacao?: string }) => {
      const { data, error } = await supabase.rpc('solicitar_inativacao', {
        p_motorista_id: v.motoristaId,
        p_motivo: v.motivo,
        p_observacao: v.observacao ?? null,
      })
      if (error) throw error
      return data as Solicitacao
    },
    onSettled: () => invalidarTudo(queryClient),
  })
}

export function useCancelarSolicitacao() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.rpc('cancelar_solicitacao_inativacao', { p_solicitacao_id: id })
      if (error) throw error
    },
    onSettled: () => invalidarTudo(queryClient),
  })
}

export function useDecidirSolicitacao() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: number; aprovar: boolean; resposta?: string }) => {
      const { error } = await supabase.rpc('decidir_solicitacao_inativacao', {
        p_solicitacao_id: v.id,
        p_aprovar: v.aprovar,
        p_resposta: v.resposta ?? null,
      })
      if (error) throw error
    },
    onSettled: () => invalidarTudo(queryClient),
  })
}
