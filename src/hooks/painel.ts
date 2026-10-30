import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export interface LinhaPainel {
  galpao: string | null
  ativos: number
  inativos: number
  nunca_rodou: number
  parados_30: number
  pedidos_pendentes: number
  pedidos_atrasados: number
}

/** Números por galpão (painel_atencao respeita a RLS: cada um vê os seus galpões). */
export function useResumo() {
  return useQuery({
    queryKey: ['resumo'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('painel_atencao')
      if (error) throw error
      return ((data ?? []) as LinhaPainel[]).map((l) => ({
        ...l,
        ativos: Number(l.ativos),
        inativos: Number(l.inativos),
        nunca_rodou: Number(l.nunca_rodou),
        parados_30: Number(l.parados_30),
        pedidos_pendentes: Number(l.pedidos_pendentes),
        pedidos_atrasados: Number(l.pedidos_atrasados),
      }))
    },
    refetchInterval: 60_000,
  })
}
