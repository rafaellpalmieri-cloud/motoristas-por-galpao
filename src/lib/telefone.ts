/** Só dígitos; acrescenta 55 (Brasil) quando vier com DDD + número. */
export function telefoneInternacional(celular: string | null): string | null {
  const digitos = (celular ?? '').replace(/\D/g, '')
  if (!digitos) return null
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`
  return digitos
}

export function linkTelefone(celular: string | null): string | null {
  const numero = telefoneInternacional(celular)
  return numero ? `tel:+${numero}` : null
}

export function linkWhatsApp(celular: string | null): string | null {
  const numero = telefoneInternacional(celular)
  return numero ? `https://wa.me/${numero}` : null
}

export function formatarCelular(celular: string | null): string {
  const d = (celular ?? '').replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return celular ?? ''
}
