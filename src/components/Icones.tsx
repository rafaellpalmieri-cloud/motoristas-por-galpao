// Ícones de linha (traço 1,8) no espírito dos símbolos do iOS. Desenhos próprios.
import type { SVGProps } from 'react'

type Props = SVGProps<SVGSVGElement> & { cheio?: boolean }

function Base({ children, cheio, ...resto }: Props & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={cheio ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={cheio ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...resto}
    >
      {children}
    </svg>
  )
}

export function IconeMotoristas({ cheio, ...p }: Props) {
  return cheio ? (
    <Base cheio {...p}>
      <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7.5 0a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 20c0-3.3 3.1-6 7-6s7 2.7 7 6v1H2v-1Zm15.5 1v-1c0-1.9-.7-3.6-1.9-4.9.3 0 .6-.1.9-.1 3.3 0 6 2.2 6 5v1h-5Z" />
    </Base>
  ) : (
    <Base {...p}>
      <circle cx="9" cy="7" r="3.5" />
      <path d="M2.5 20.5c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6" />
      <circle cx="16.8" cy="7.5" r="3" />
      <path d="M17.5 14.6c2.4.4 4 2.2 4 4.4v1.5" />
    </Base>
  )
}

export function IconeSino({ cheio, ...p }: Props) {
  return cheio ? (
    <Base cheio {...p}>
      <path d="M12 2.5a6 6 0 0 0-6 6v3.7l-1.7 3.1A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.7L18 12.2V8.5a6 6 0 0 0-6-6Zm-2.8 16a3 3 0 0 0 5.6 0H9.2Z" />
    </Base>
  ) : (
    <Base {...p}>
      <path d="M6 8.5a6 6 0 1 1 12 0v3.8l1.8 3.3a.9.9 0 0 1-.8 1.4H5a.9.9 0 0 1-.8-1.4L6 12.3V8.5Z" />
      <path d="M9.5 19.5a2.6 2.6 0 0 0 5 0" />
    </Base>
  )
}

export function IconeDocumento({ cheio, ...p }: Props) {
  return cheio ? (
    <Base cheio {...p}>
      <path d="M7 2.5h7.2c.5 0 1 .2 1.4.6l3.3 3.3c.4.4.6.9.6 1.4V19a2.5 2.5 0 0 1-2.5 2.5H7A2.5 2.5 0 0 1 4.5 19V5A2.5 2.5 0 0 1 7 2.5Zm1.5 9a.8.8 0 0 0 0 1.6h7a.8.8 0 0 0 0-1.6h-7Zm0 3.5a.8.8 0 0 0 0 1.6h5a.8.8 0 0 0 0-1.6h-5Z" />
    </Base>
  ) : (
    <Base {...p}>
      <path d="M14 3H7a2.5 2.5 0 0 0-2.5 2.5v13A2.5 2.5 0 0 0 7 21h10a2.5 2.5 0 0 0 2.5-2.5V8.5L14 3Z" />
      <path d="M14 3v5.5h5.5M8.5 12.5h7M8.5 16h5" />
    </Base>
  )
}

export function IconeGrafico({ cheio, ...p }: Props) {
  return (
    <Base {...p} strokeWidth={cheio ? 2.4 : 1.8} fill="none">
      <path d="M4 20.5h16" />
      <path d="M7 17v-5M12 17V7M17 17v-8" />
    </Base>
  )
}

export function IconeEquipe({ cheio, ...p }: Props) {
  return cheio ? (
    <Base cheio {...p}>
      <path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9Zm-8 8.5c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5v.5H4v-.5Z" />
    </Base>
  ) : (
    <Base {...p}>
      <circle cx="12" cy="7.5" r="4" />
      <path d="M4.5 20.5c0-3.6 3.4-6.5 7.5-6.5s7.5 2.9 7.5 6.5" />
    </Base>
  )
}

export function IconeSair(p: Props) {
  return (
    <Base {...p}>
      <path d="M14 4h3.5A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5H14" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </Base>
  )
}

export function IconeTelefone(p: Props) {
  return (
    <Base {...p}>
      <path d="M6.6 3.5h2.2l1.6 4-2 1.3a11 11 0 0 0 6.8 6.8l1.3-2 4 1.6v2.2a2 2 0 0 1-2 2A15.5 15.5 0 0 1 4.6 5.5a2 2 0 0 1 2-2Z" />
    </Base>
  )
}

export function IconeBaixar(p: Props) {
  return (
    <Base {...p}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
    </Base>
  )
}

export function IconeSol(p: Props) {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </Base>
  )
}

export function IconeLua(p: Props) {
  return (
    <Base {...p}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
    </Base>
  )
}
