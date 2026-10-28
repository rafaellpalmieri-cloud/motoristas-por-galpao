import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import type { Presenca, Treinamento } from '../lib/tipos'

const CAMPOS =
  'id, galpao, nome, telefone, inicio, status, presenca, presenca_obs, presenca_por_nome, presenca_em, criado_em'

/** Mesma janela que o Apps Script lê das agendas: 7 dias para trás, 60 para frente. */
export const DIAS_ANTES = 7
export const DIAS_DEPOIS = 60

// A RLS já limita aos galpões do usuário.
export function useTreinamentos() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['treinamentos'],
    enabled: !!session,
    refetchInterval: 60_000,
    queryFn: async () => {
      const de = new Date(Date.now() - DIAS_ANTES * 864e5).toISOString()
      const ate = new Date(Date.now() + DIAS_DEPOIS * 864e5).toISOString()
      const { data, error } = await supabase
        .from('treinamentos')
        .select(CAMPOS)
        .gte('inicio', de)
        .lt('inicio', ate)
        .order('inicio')
        .limit(2000)
      if (error) throw error
      return data as Treinamento[]
    },
  })
}

export function useMarcarPresenca() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, presenca, observacao }: { id: number; presenca: Presenca | null; observacao?: string }) => {
      const { error } = await supabase.rpc('marcar_presenca_treinamento', {
        p_id: id,
        p_presenca: presenca,
        p_observacao: observacao?.trim() || null,
      })
      if (error) throw error
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['treinamentos'] })
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
    },
  })
}

/** Hora atual, atualizada a cada minuto (para saber se o treinamento já passou). */
export function useAgora() {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return agora
}
