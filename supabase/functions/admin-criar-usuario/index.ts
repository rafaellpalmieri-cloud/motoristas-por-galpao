// Cria um dispatcher: usuário no Auth (e-mail já confirmado), perfil,
// papel "dispatcher" e galpões. Devolve a senha temporária UMA vez.
// Corpo: { "nome": "...", "email": "...", "galpoes": ["SRJ1", ...] }
import {
  corsHeaders,
  ErroHttp,
  exigirAdmin,
  gerarSenhaTemporaria,
  json,
  tratarErro,
  validarGalpoes,
} from '../_shared/admin.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

  try {
    const { admin } = await exigirAdmin(req)

    const corpo = await req.json().catch(() => {
      throw new ErroHttp(400, 'JSON inválido.')
    })
    const nome = String(corpo?.nome ?? '').trim()
    const email = String(corpo?.email ?? '').trim().toLowerCase()
    const galpoes = validarGalpoes(corpo?.galpoes)

    if (nome.length < 2 || nome.length > 120) throw new ErroHttp(400, 'Informe o nome.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroHttp(400, 'E-mail inválido.')

    const senha = gerarSenhaTemporaria()

    const { data: criado, error: erroCriar } = await admin.auth.admin.createUser({
      email,
      password: senha,
      email_confirm: true,
      user_metadata: { nome },
    })
    if (erroCriar || !criado.user) {
      const jaExiste = /already|registered|exists/i.test(erroCriar?.message ?? '')
      throw new ErroHttp(jaExiste ? 409 : 400, jaExiste ? 'Já existe um usuário com esse e-mail.' : 'Não foi possível criar o usuário.')
    }
    const userId = criado.user.id

    try {
      const { error: e1 } = await admin
        .from('perfis')
        .insert({ user_id: userId, nome, email, ativo: true, trocar_senha: true })
      if (e1) throw e1
      const { error: e2 } = await admin.from('user_roles').insert({ user_id: userId, role: 'dispatcher' })
      if (e2) throw e2
      const { error: e3 } = await admin
        .from('dispatcher_galpoes')
        .insert(galpoes.map((galpao) => ({ user_id: userId, galpao })))
      if (e3) throw e3
    } catch (erro) {
      // Desfaz o usuário no Auth para não deixar conta pela metade
      // (perfil, papel e galpões caem junto pelo ON DELETE CASCADE).
      await admin.auth.admin.deleteUser(userId)
      throw erro
    }

    return json({ user_id: userId, email, senha_temporaria: senha }, 201)
  } catch (erro) {
    return tratarErro(erro)
  }
})
