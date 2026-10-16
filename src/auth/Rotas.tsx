import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Botao, Carregando, EstadoErro } from '../components/ui'
import { mensagemErro } from '../lib/erros'
import { TelaAuth } from '../pages/TelaAuth'
import { useAuth } from './AuthProvider'

/** Exige sessão, perfil ativo e senha temporária já trocada. */
export function RotaProtegida() {
  const { session, carregandoSessao, usuario, carregandoUsuario, erroUsuario, recarregarUsuario, sair, recuperandoSenha } =
    useAuth()
  const local = useLocation()

  if (carregandoSessao || carregandoUsuario) return <Carregando />
  if (!session) return <Navigate to="/login" replace />
  if (recuperandoSenha) return <Navigate to="/redefinir-senha" replace />
  if (erroUsuario) return <EstadoErro mensagem={mensagemErro(erroUsuario)} aoTentarDeNovo={recarregarUsuario} />

  const perfil = usuario?.perfil
  if (!perfil || !perfil.ativo) {
    return (
      <TelaAuth titulo="Acesso não liberado">
        <div className="flex flex-col gap-3 text-center">
          <p className="text-slate-700">
            {perfil ? 'Sua conta está desativada.' : 'Seu usuário ainda não tem perfil no app.'} Fale com o administrador.
          </p>
          <Botao variante="secundario" onClick={sair}>
            Sair
          </Botao>
        </div>
      </TelaAuth>
    )
  }
  if (perfil.trocar_senha && local.pathname !== '/trocar-senha') return <Navigate to="/trocar-senha" replace />
  return <Outlet />
}

export function RotaAdmin() {
  const { ehAdmin } = useAuth()
  if (!ehAdmin) return <Navigate to="/" replace />
  return <Outlet />
}
