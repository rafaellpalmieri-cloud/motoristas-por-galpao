import { useState, type FormEvent } from 'react'
import { Botao, Campo } from '../components/ui'
import { mensagemErro } from '../lib/erros'
import { supabase } from '../lib/supabase'

/** Formulário de nova senha (troca obrigatória e recuperação por e-mail). */
export function NovaSenhaForm({ aoConcluir }: { aoConcluir: () => Promise<void> | void }) {
  const [senha, setSenha] = useState('')
  const [confirmacao, setConfirmacao] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function salvar(e: FormEvent) {
    e.preventDefault()
    if (senha.length < 8) return setErro('A senha precisa ter pelo menos 8 caracteres.')
    if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return setErro('Use letras e números.')
    if (senha !== confirmacao) return setErro('As senhas não conferem.')
    setErro(null)
    setEnviando(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) {
      setEnviando(false)
      return setErro(
        /different from the old/i.test(error.message) ? 'A nova senha precisa ser diferente da atual.' : mensagemErro(error),
      )
    }
    const { error: e2 } = await supabase.rpc('marcar_senha_trocada')
    setEnviando(false)
    if (e2) return setErro(mensagemErro(e2))
    await aoConcluir()
  }

  return (
    <form onSubmit={salvar} className="flex flex-col gap-4">
      <Campo
        rotulo="Nova senha"
        type="password"
        autoComplete="new-password"
        required
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        dica="Mínimo de 8 caracteres, com letras e números."
      />
      <Campo
        rotulo="Confirme a nova senha"
        type="password"
        autoComplete="new-password"
        required
        value={confirmacao}
        onChange={(e) => setConfirmacao(e.target.value)}
      />
      {erro && (
        <p role="alert" className="text-sm text-rose-700">
          {erro}
        </p>
      )}
      <Botao type="submit" carregando={enviando}>
        Salvar nova senha
      </Botao>
    </form>
  )
}
