import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { Papel, Perfil } from '../lib/tipos'

interface DadosUsuario {
  perfil: Perfil | null
  papeis: Papel[]
  galpoes: string[]
}

interface AuthContexto {
  session: Session | null
  carregandoSessao: boolean
  recuperandoSenha: boolean
  usuario: DadosUsuario | undefined
  carregandoUsuario: boolean
  erroUsuario: unknown
  ehAdmin: boolean
  sair: () => Promise<void>
  recarregarUsuario: () => Promise<unknown>
  concluirRecuperacao: () => void
}

const Contexto = createContext<AuthContexto | null>(null)

async function buscarDadosUsuario(userId: string): Promise<DadosUsuario> {
  const [perfil, papeis, galpoes] = await Promise.all([
    supabase
      .from('perfis')
      .select('user_id, nome, email, telefone, ativo, trocar_senha, alertas_vistos_em')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('user_roles').select('role').eq('user_id', userId),
    supabase.from('dispatcher_galpoes').select('galpao').eq('user_id', userId).order('galpao'),
  ])
  if (perfil.error) throw perfil.error
  if (papeis.error) throw papeis.error
  if (galpoes.error) throw galpoes.error
  return {
    perfil: perfil.data as Perfil | null,
    papeis: (papeis.data ?? []).map((p) => p.role as Papel),
    galpoes: (galpoes.data ?? []).map((g) => g.galpao as string),
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<Session | null>(null)
  const [carregandoSessao, setCarregandoSessao] = useState(true)
  const [recuperandoSenha, setRecuperandoSenha] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setCarregandoSessao(false)
    })
    const { data } = supabase.auth.onAuthStateChange((evento, novaSessao) => {
      if (evento === 'PASSWORD_RECOVERY') setRecuperandoSenha(true)
      if (evento === 'SIGNED_OUT') {
        setRecuperandoSenha(false)
        queryClient.clear()
      }
      setSession(novaSessao)
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  const userId = session?.user.id
  const consulta = useQuery({
    queryKey: ['usuario', userId],
    queryFn: () => buscarDadosUsuario(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
  })

  const valor: AuthContexto = {
    session,
    carregandoSessao,
    recuperandoSenha,
    usuario: consulta.data,
    carregandoUsuario: !!userId && consulta.isPending,
    erroUsuario: consulta.error,
    ehAdmin: !!consulta.data?.perfil?.ativo && !!consulta.data?.papeis.includes('admin'),
    sair: async () => {
      await supabase.auth.signOut()
    },
    recarregarUsuario: () => consulta.refetch(),
    concluirRecuperacao: () => setRecuperandoSenha(false),
  }

  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContexto {
  const ctx = useContext(Contexto)
  if (!ctx) throw new Error('useAuth fora do AuthProvider')
  return ctx
}
