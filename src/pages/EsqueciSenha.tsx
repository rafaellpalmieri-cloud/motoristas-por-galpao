import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Botao, Campo } from '../components/ui'
import { mensagemErro } from '../lib/erros'
import { supabase } from '../lib/supabase'
import { TelaAuth } from './TelaAuth'

export default function EsqueciSenha() {
  const [email, setEmail] = useState('')
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function enviar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    })
    setEnviando(false)
    if (error) setErro(mensagemErro(error))
    else setEnviado(true)
  }

  return (
    <TelaAuth titulo="Esqueci minha senha" subtitulo="Enviaremos um link para criar uma nova senha">
      {enviado ? (
        <div className="flex flex-col gap-4 text-center">
          <p className="text-slate-700">
            Se <strong>{email}</strong> estiver cadastrado, você receberá um e-mail em instantes. Confira também a caixa de
            spam.
          </p>
          <Link to="/login" className="flex min-h-11 items-center justify-center font-medium text-sky-800">
            Voltar para o login
          </Link>
        </div>
      ) : (
        <form onSubmit={enviar} className="flex flex-col gap-4">
          <Campo
            rotulo="E-mail"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {erro && (
            <p role="alert" className="text-sm text-rose-700">
              {erro}
            </p>
          )}
          <Botao type="submit" carregando={enviando}>
            Enviar link
          </Botao>
          <Link to="/login" className="flex min-h-11 items-center justify-center text-sm font-medium text-sky-800">
            Voltar para o login
          </Link>
        </form>
      )}
    </TelaAuth>
  )
}
