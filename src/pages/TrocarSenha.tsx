import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { NovaSenhaForm } from './NovaSenhaForm'
import { TelaAuth } from './TelaAuth'

/** Troca obrigatória no primeiro acesso (ou após o admin redefinir a senha). */
export default function TrocarSenha() {
  const { recarregarUsuario, sair } = useAuth()
  const navigate = useNavigate()
  return (
    <TelaAuth titulo="Crie sua senha" subtitulo="Por segurança, troque a senha temporária antes de continuar.">
      <NovaSenhaForm
        aoConcluir={async () => {
          await recarregarUsuario()
          navigate('/', { replace: true })
        }}
      />
      <button type="button" onClick={sair} className="mt-3 min-h-11 w-full text-sm text-slate-500">
        Sair
      </button>
    </TelaAuth>
  )
}
