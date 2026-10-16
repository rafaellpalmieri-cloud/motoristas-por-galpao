import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { buscarTodas } from '../lib/paginacao'
import { supabase } from '../lib/supabase'
import type { Historico, Motorista, Status } from '../lib/tipos'

const CAMPOS_MOTORISTA =
  'id, codigo, nome_completo, celular, placa, modal, galpao, status, inativo_desde, motivo_inativacao, atualizado_em, atualizado_por'

// A RLS já limita aos galpões do usuário; aqui só buscamos tudo o que ele pode ver.
export function useMotoristas() {
  return useQuery({
    queryKey: ['motoristas'],
    queryFn: () =>
      buscarTodas<Motorista>((de, ate) =>
        supabase
          .from('motoristas')
          .select(CAMPOS_MOTORISTA)
          .order('nome_completo', { ascending: true, nullsFirst: false })
          .order('id')
          .range(de, ate)
          .returns<Motorista[]>(),
      ),
    refetchInterval: 60_000,
  })
}

export function useMotorista(id: string | undefined) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: ['motorista', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from('motoristas').select(CAMPOS_MOTORISTA).eq('id', id!).maybeSingle()
      if (error) throw error
      return data as Motorista | null
    },
    placeholderData: () => queryClient.getQueryData<Motorista[]>(['motoristas'])?.find((m) => m.id === id),
  })
}

export function useHistorico(motoristaId: string | undefined) {
  return useQuery({
    queryKey: ['historico', motoristaId],
    enabled: !!motoristaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('motorista_historico')
        .select('*')
        .eq('motorista_id', motoristaId!)
        .order('alterado_em', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as Historico[]
    },
  })
}

export interface DadosAlteracao {
  motorista: Motorista
  novoStatus: Status
  motivo?: string
  observacao?: string
}

/** Inativa/reativa com atualização otimista e desfaz em caso de erro. */
export function useAlterarStatus() {
  const queryClient = useQueryClient()
  const { session } = useAuth()

  return useMutation({
    mutationFn: async ({ motorista, novoStatus, motivo, observacao }: DadosAlteracao) => {
      const { data, error } = await supabase.rpc('alterar_status_motorista', {
        p_motorista_id: motorista.id,
        p_novo_status: novoStatus,
        p_motivo: motivo ?? null,
        p_observacao: observacao ?? null,
      })
      if (error) throw error
      return data as Motorista
    },
    onMutate: async ({ motorista, novoStatus, motivo }) => {
      await queryClient.cancelQueries({ queryKey: ['motoristas'] })
      await queryClient.cancelQueries({ queryKey: ['motorista', motorista.id] })
      const anteriorLista = queryClient.getQueryData<Motorista[]>(['motoristas'])
      const anteriorItem = queryClient.getQueryData<Motorista | null>(['motorista', motorista.id])

      const otimista: Motorista = {
        ...motorista,
        status: novoStatus,
        inativo_desde: novoStatus === 'inativo' ? new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }) : null,
        motivo_inativacao: novoStatus === 'inativo' ? (motivo ?? null) : null,
        atualizado_em: new Date().toISOString(),
        atualizado_por: session?.user.id ?? null,
      }
      queryClient.setQueryData<Motorista[]>(['motoristas'], (lista) =>
        lista?.map((m) => (m.id === motorista.id ? otimista : m)),
      )
      queryClient.setQueryData(['motorista', motorista.id], otimista)
      return { anteriorLista, anteriorItem }
    },
    onError: (_erro, { motorista }, ctx) => {
      if (ctx?.anteriorLista) queryClient.setQueryData(['motoristas'], ctx.anteriorLista)
      if (ctx?.anteriorItem !== undefined) queryClient.setQueryData(['motorista', motorista.id], ctx.anteriorItem)
    },
    onSettled: (_d, _e, { motorista }) => {
      queryClient.invalidateQueries({ queryKey: ['motoristas'] })
      queryClient.invalidateQueries({ queryKey: ['motorista', motorista.id] })
      queryClient.invalidateQueries({ queryKey: ['historico', motorista.id] })
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
      queryClient.invalidateQueries({ queryKey: ['resumo'] })
    },
  })
}

// ---------------------------------------------------------------------
// Alertas de inativação (sino)
// ---------------------------------------------------------------------
export interface Alerta extends Historico {
  motoristas: { nome_completo: string | null; placa: string | null; codigo: string } | null
}

/** Quantas inativações feitas por OUTRAS pessoas desde a última visita aos alertas. */
export function useContagemAlertas() {
  const { session, usuario } = useAuth()
  const vistosEm = usuario?.perfil?.alertas_vistos_em
  return useQuery({
    queryKey: ['alertas', 'contagem', vistosEm],
    enabled: !!session && !!vistosEm,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from('motorista_historico')
        .select('id', { count: 'exact', head: true })
        .eq('status_novo', 'inativo')
        .gt('alterado_em', vistosEm!)
        .neq('alterado_por', session!.user.id)
      if (error) throw error
      return count ?? 0
    },
  })
}

export function useAlertas() {
  return useQuery({
    queryKey: ['alertas', 'lista'],
    queryFn: async () => {
      const desde = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
      const { data, error } = await supabase
        .from('motorista_historico')
        .select('*, motoristas(nome_completo, placa, codigo)')
        .eq('status_novo', 'inativo')
        .gte('alterado_em', desde)
        .order('alterado_em', { ascending: false })
        .limit(200)
      if (error) throw error
      return data as Alerta[]
    },
  })
}

export function useMarcarAlertasVistos() {
  const { recarregarUsuario } = useAuth()
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('marcar_alertas_vistos')
      if (error) throw error
    },
    onSuccess: () => recarregarUsuario(),
  })
}
