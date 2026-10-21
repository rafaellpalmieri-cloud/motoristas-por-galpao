export const GALPOES = ['SRJ1', 'SRJ2', 'SRJ4', 'SRJ5', 'SRJ8', 'SRJ9', 'SRJ10', 'SRJ13', 'SRJ17', 'HUB'] as const

export const MOTIVOS_INATIVACAO = ['Parou de rodar', 'Saiu da operação', 'Documentação', 'Outro'] as const

// Iguais aos de validar_motivo_reativacao() no banco.
export const MOTIVOS_REATIVACAO = ['Voltou a rodar', 'Documentação regularizada', 'Outro'] as const

export const SEM_GALPAO = '__sem_galpao__'

export function normalizarGalpao(valor: string | null | undefined): string {
  return (valor ?? '').toUpperCase().replace(/\s/g, '')
}

export function galpaoValido(valor: string): boolean {
  return (GALPOES as readonly string[]).includes(valor)
}
