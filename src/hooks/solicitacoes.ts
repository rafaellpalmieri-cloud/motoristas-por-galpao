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

/** Pede a inativação ou a reativação de uma ou mais placas (um pedido agrupado). */
export function useSolicitar() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { tipo: Solicitacao['tipo']; motoristaIds: string[]; motivo?: string; observacao?: string }) => {
      const { error } =
        v.tipo === 'reativacao'
          ? await supabase.rpc('solicitar_reativacao_lote', {
              p_motorista_ids: v.motoristaIds,
              p_observacao: v.observacao ?? null,
            })
          : await supabase.rpc('solicitar_inativacao_lote', {
              p_motorista_ids: v.motoristaIds,
              p_motivo: v.motivo ?? null,
              p_observacao: v.observacao ?? null,
            })
      if (error) throw error
    },
    onSettled: () => invalidarTudo(queryClient),
  })
}

/** Cancela um pedido (todas as placas pendentes do grupo, ou o pedido avulso). */
export function useCancelarSolicitacao() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (s: Pick<Solicitacao, 'id' | 'grupo'>) => {
      const { error } = s.grupo
        ? await supabase.rpc('cancelar_grupo_inativacao', { p_grupo: s.grupo })
        : await supabase.rpc('cancelar_solicitacao_inativacao', { p_solicitacao_id: s.id })
      if (error) throw error
    },
    onSettled: () => invalidarTudo(queryClient),
  })
}

/** Aprova ou recusa um pedido (todas as placas pendentes do grupo, ou o pedido avulso). */
export function useDecidirSolicitacao() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { s: Pick<Solicitacao, 'id' | 'grupo'>; aprovar: boolean; resposta?: string }) => {
      const { error } = v.s.grupo
        ? await supabase.rpc('decidir_grupo_inativacao', {
            p_grupo: v.s.grupo,
            p_aprovar: v.aprovar,
            p_resposta: v.resposta ?? null,
          })
        : await supabase.rpc('decidir_solicitacao_inativacao', {
            p_solicitacao_id: v.s.id,
            p_aprovar: v.aprovar,
            p_resposta: v.resposta ?? null,
          })
      if (error) throw error
    },
    onSettled: () => invalidarTudo(queryClient),
  })
}

/** Junta pedidos do mesmo grupo (mesmo motorista, várias placas). */
export function agruparPedidos(lista: Solicitacao[]): Solicitacao[][] {
  const grupos = new Map<string, Solicitacao[]>()
  for (const s of lista) {
    const chave = s.grupo ?? `avulso-${s.id}`
    grupos.set(chave, [...(grupos.get(chave) ?? []), s])
  }
  return [...grupos.values()]
}
