import { FunctionsHttpError } from '@supabase/supabase-js'

/** Mensagem amigável para erros do Supabase/rede. */
export function mensagemErro(erro: unknown): string {
  if (!erro) return 'Erro desconhecido.'
  if (typeof erro === 'object' && erro !== null && 'message' in erro) {
    const msg = String((erro as { message: string }).message)
    if (/failed to fetch|network/i.test(msg)) return 'Sem conexão. Verifique a internet e tente de novo.'
    if (/invalid login credentials/i.test(msg)) return 'E-mail ou senha incorretos.'
    if (/user is banned/i.test(msg)) return 'Sua conta está desativada. Fale com o administrador.'
    if (/JWT expired/i.test(msg)) return 'Sua sessão expirou. Entre novamente.'
    if (/rate limit/i.test(msg)) return 'Muitas tentativas. Aguarde alguns minutos.'
    return msg
  }
  return String(erro)
}

/** Lê a mensagem { erro } devolvida pelas Edge Functions. */
export async function mensagemErroFuncao(erro: unknown): Promise<string> {
  if (erro instanceof FunctionsHttpError) {
    try {
      const corpo = await erro.context.json()
      if (corpo?.erro) return String(corpo.erro)
    } catch {
      /* corpo não é JSON */
    }
  }
  return mensagemErro(erro)
}
