import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { SEM_GALPAO } from '../lib/constantes'
import { buscarTodas } from '../lib/paginacao'
import { supabase } from '../lib/supabase'
import type { Historico, Motorista, Status } from '../lib/tipos'

const CAMPOS_MOTORISTA =
  'id, codigo, nome_completo, celular, placa, modal, galpao, status, inativo_desde, motivo_inativacao, atualizado_em, atualizado_por, cpf_mascarado, pessoa_id, realizou_rotas, qtd_rotas, ultima_rota'

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
  motoristas: Motorista[]
  novoStatus: Status
  motivo?: string
  observacao?: string
}

/** Inativa (admin) ou reativa uma ou mais placas, com atualização otimista e desfaz em caso de erro. */
export function useAlterarStatus() {
  const queryClient = useQueryClient()
  const { session } = useAuth()

  return useMutation({
    mutationFn: async ({ motoristas, novoStatus, motivo, observacao }: DadosAlteracao) => {
      const { error } = await supabase.rpc('alterar_status_lote', {
        p_motorista_ids: motoristas.map((m) => m.id),
        p_novo_status: novoStatus,
        p_motivo: motivo ?? null,
        p_observacao: observacao ?? null,
      })
      if (error) throw error
    },
    onMutate: async ({ motoristas, novoStatus, motivo }) => {
      await queryClient.cancelQueries({ queryKey: ['motoristas'] })
      const ids = new Set(motoristas.map((m) => m.id))
      const anteriorLista = queryClient.getQueryData<Motorista[]>(['motoristas'])
      const anteriores = motoristas.map((m) => [m.id, queryClient.getQueryData<Motorista | null>(['motorista', m.id])] as const)

      const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' })
      const aplicar = (m: Motorista): Motorista => ({
        ...m,
        status: novoStatus,
        inativo_desde: novoStatus === 'inativo' ? hoje : null,
        motivo_inativacao: novoStatus === 'inativo' ? (motivo ?? null) : null,
        atualizado_em: new Date().toISOString(),
        atualizado_por: session?.user.id ?? null,
      })
      queryClient.setQueryData<Motorista[]>(['motoristas'], (lista) => lista?.map((m) => (ids.has(m.id) ? aplicar(m) : m)))
      for (const m of motoristas) queryClient.setQueryData(['motorista', m.id], aplicar(m))
      return { anteriorLista, anteriores }
    },
    onError: (_erro, _vars, ctx) => {
      if (ctx?.anteriorLista) queryClient.setQueryData(['motoristas'], ctx.anteriorLista)
      for (const [id, item] of ctx?.anteriores ?? []) if (item !== undefined) queryClient.setQueryData(['motorista', id], item)
    },
    onSettled: (_d, _e, { motoristas }) => {
      queryClient.invalidateQueries({ queryKey: ['motoristas'] })
      for (const m of motoristas) {
        queryClient.invalidateQueries({ queryKey: ['motorista', m.id] })
        queryClient.invalidateQueries({ queryKey: ['historico', m.id] })
      }
      queryClient.invalidateQueries({ queryKey: ['solicitacoes'] })
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

/** Quantas inativações feitas por OUTRAS pessoas (ou pela planilha) desde a última visita aos alertas. */
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
        // Inclui as inativações vindas da planilha (alterado_por nulo).
        .or(`alterado_por.is.null,alterado_por.neq.${session!.user.id}`)
      if (error) throw error
      return count ?? 0
    },
  })
}

export const LIMITE_ALERTAS = 500

export interface FiltrosAlertas {
  de: string // AAAA-MM-DD (dia inteiro, horário de Brasília)
  ate: string
  galpao: string // '' = todos; SEM_GALPAO = sem galpão
}

/** Inativações no período e galpão escolhidos (a RLS já limita aos galpões do usuário). */
export function useAlertas({ de, ate, galpao }: FiltrosAlertas) {
  return useQuery({
    queryKey: ['alertas', 'lista', de, ate, galpao],
    placeholderData: (anterior) => anterior,
    queryFn: async () => {
      // Brasília não tem horário de verão desde 2019: -03:00 fixo.
      let consulta = supabase
        .from('motorista_historico')
        .select('*, motoristas(nome_completo, placa, codigo)')
        .eq('status_novo', 'inativo')
        .gte('alterado_em', `${de}T00:00:00-03:00`)
        .lte('alterado_em', `${ate}T23:59:59.999-03:00`)
      if (galpao === SEM_GALPAO) consulta = consulta.is('galpao', null)
      else if (galpao) consulta = consulta.eq('galpao', galpao)
      const { data, error } = await consulta.order('alterado_em', { ascending: false }).limit(LIMITE_ALERTAS)
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

/** CPF completo de todos os motoristas (só admin; usado na busca). */
export function useCpfsCompletos(ativo: boolean) {
  return useQuery({
    queryKey: ['cpfs-completos'],
    enabled: ativo,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const lista = await buscarTodas<{ id: string; cpf: string }>((de, ate) =>
        supabase.rpc('cpfs_completos').range(de, ate),
      )
      return new Map(lista.map((c) => [c.id, c.cpf]))
    },
  })
}

/** CPF completo de um motorista (só admin). */
export function useCpfCompleto(motoristaId: string | undefined, ativo: boolean) {
  return useQuery({
    queryKey: ['cpf-completo', motoristaId],
    enabled: ativo && !!motoristaId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('cpf_completo', { p_motorista_id: motoristaId! })
      if (error) throw error
      return (data as string | null) ?? null
    },
  })
}
