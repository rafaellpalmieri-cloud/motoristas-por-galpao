export type Status = 'ativo' | 'inativo'
export type Papel = 'admin' | 'dispatcher'

export interface Motorista {
  id: string
  codigo: string
  nome_completo: string | null
  celular: string | null
  placa: string | null
  modal: string | null
  galpao: string | null
  status: Status
  inativo_desde: string | null
  motivo_inativacao: string | null
  atualizado_em: string
  atualizado_por: string | null
}

export interface Historico {
  id: number
  motorista_id: string
  galpao: string | null
  status_anterior: Status | null
  status_novo: Status
  motivo: string | null
  observacao: string | null
  alterado_por: string | null
  alterado_por_nome: string | null
  alterado_em: string
  origem: 'app' | 'planilha'
}

export interface Perfil {
  user_id: string
  nome: string
  email: string
  telefone: string | null
  ativo: boolean
  trocar_senha: boolean
  alertas_vistos_em: string
}
