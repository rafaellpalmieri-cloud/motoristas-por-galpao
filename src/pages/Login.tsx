import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { Botao, Campo } from '../components/ui'
import { mensagemErro } from '../lib/erros'
import { supabase } from '../lib/supabase'
import { TelaAuth } from './TelaAuth'

export default function Login() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setErro(null)
    setEnviando(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setEnviando(false)
    if (error) setErro(mensagemErro(error))
  }

  return (
    <TelaAuth titulo="Motoristas por Galpão" subtitulo="Entre com seu e-mail e senha">
      <form onSubmit={entrar} className="flex flex-col gap-4">
        <Campo
          rotulo="E-mail"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Campo
          rotulo="Senha"
          type="password"
          autoComplete="current-password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
        />
        {erro && (
          <p role="alert" className="text-sm text-rose-700">
            {erro}
          </p>
        )}
        <Botao type="submit" carregando={enviando}>
          Entrar
        </Botao>
        <Link to="/esqueci-senha" className="flex min-h-11 items-center justify-center text-sm font-medium text-sky-800">
          Esqueci minha senha
        </Link>
      </form>
    </TelaAuth>
  )
}
