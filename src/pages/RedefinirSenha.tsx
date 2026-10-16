import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Carregando } from '../components/ui'
import { NovaSenhaForm } from './NovaSenhaForm'
import { TelaAuth } from './TelaAuth'

/** Destino do link "Esqueci minha senha" enviado por e-mail. */
export default function RedefinirSenha() {
  const { session, carregandoSessao, recarregarUsuario, concluirRecuperacao } = useAuth()
  const navigate = useNavigate()

  if (carregandoSessao) return <Carregando texto="Validando link…" />

  if (!session) {
    return (
      <TelaAuth titulo="Link inválido ou expirado">
        <div className="flex flex-col gap-3 text-center">
          <p className="text-slate-700">Peça um novo link de recuperação.</p>
          <Link to="/esqueci-senha" className="flex min-h-11 items-center justify-center font-medium text-sky-800">
            Pedir novo link
          </Link>
        </div>
      </TelaAuth>
    )
  }

  return (
    <TelaAuth titulo="Nova senha" subtitulo={session.user.email}>
      <NovaSenhaForm
        aoConcluir={async () => {
          concluirRecuperacao()
          await recarregarUsuario()
          navigate('/', { replace: true })
        }}
      />
    </TelaAuth>
  )
}
