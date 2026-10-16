// Ações de admin sobre um usuário existente.
// Corpo: { "acao": "redefinir_senha" | "desativar" | "reativar", "user_id": "uuid" }
//  - redefinir_senha: gera nova senha temporária (devolvida UMA vez) e exige troca no próximo login.
//  - desativar: perfil inativo + bloqueio de login no Auth.
//  - reativar: desfaz o bloqueio.
import { comCors, ErroHttp, exigirAdmin, gerarSenhaTemporaria, json, tratarErro } from '../_shared/admin.ts'

const ACOES = ['redefinir_senha', 'desativar', 'reativar'] as const
type Acao = (typeof ACOES)[number]

Deno.serve(
  comCors(async (req) => {
  if (req.method !== 'POST') return json({ erro: 'Método não permitido.' }, 405)

  try {
    const { admin, adminId } = await exigirAdmin(req)

    const corpo = await req.json().catch(() => {
      throw new ErroHttp(400, 'JSON inválido.')
    })
    const acao = corpo?.acao as Acao
    const userId = String(corpo?.user_id ?? '')

    if (!ACOES.includes(acao)) throw new ErroHttp(400, 'Ação inválida.')
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new ErroHttp(400, 'Usuário inválido.')
    if (userId === adminId && acao !== 'redefinir_senha') {
      throw new ErroHttp(400, 'Você não pode desativar a própria conta.')
    }

    const { data: perfil, error: erroPerfil } = await admin
      .from('perfis')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()
    if (erroPerfil) throw erroPerfil
    if (!perfil) throw new ErroHttp(404, 'Usuário não encontrado.')

    if (acao === 'redefinir_senha') {
      const senha = gerarSenhaTemporaria()
      const { error } = await admin.auth.admin.updateUserById(userId, { password: senha })
      if (error) throw new ErroHttp(400, 'Não foi possível redefinir a senha.')
      const { error: e2 } = await admin.from('perfis').update({ trocar_senha: true }).eq('user_id', userId)
      if (e2) throw e2
      return json({ ok: true, senha_temporaria: senha })
    }

    const desativar = acao === 'desativar'
    const { error } = await admin.auth.admin.updateUserById(userId, {
      // ~100 anos = bloqueado; "none" remove o bloqueio.
      ban_duration: desativar ? '876000h' : 'none',
    })
    if (error) throw new ErroHttp(400, 'Não foi possível atualizar o bloqueio no Auth.')
    const { error: e2 } = await admin.from('perfis').update({ ativo: !desativar }).eq('user_id', userId)
    if (e2) throw e2

    return json({ ok: true })
  } catch (erro) {
    return tratarErro(erro)
  }
  }),
)
