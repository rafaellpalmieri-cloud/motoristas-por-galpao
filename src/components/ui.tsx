import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import type { Status } from '../lib/tipos'

type Variante = 'primario' | 'secundario' | 'perigo' | 'sucesso' | 'fantasma'

const estilosVariante: Record<Variante, string> = {
  primario: 'bg-sky-700 text-white hover:bg-sky-800 active:bg-sky-900',
  secundario: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 active:bg-slate-100',
  perigo: 'bg-rose-600 text-white hover:bg-rose-700 active:bg-rose-800',
  sucesso: 'bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-800',
  fantasma: 'bg-transparent text-sky-800 hover:bg-sky-50 active:bg-sky-100',
}

export function Botao({
  variante = 'primario',
  carregando = false,
  className = '',
  children,
  disabled,
  ...resto
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; carregando?: boolean }) {
  return (
    <button
      {...resto}
      disabled={disabled || carregando}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-base font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-60 ${estilosVariante[variante]} ${className}`}
    >
      {carregando && <Spinner pequeno />}
      {children}
    </button>
  )
}

export function Campo({
  rotulo,
  dica,
  erro,
  ...resto
}: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; dica?: string; erro?: string | null }) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {rotulo}
      </label>
      <input
        id={id}
        {...resto}
        className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200"
      />
      {dica && !erro && <p className="text-sm text-slate-500">{dica}</p>}
      {erro && <p className="text-sm text-rose-700">{erro}</p>}
    </div>
  )
}

export function Spinner({ pequeno = false }: { pequeno?: boolean }) {
  return (
    <span
      role="status"
      aria-label="Carregando"
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${pequeno ? 'h-4 w-4' : 'h-8 w-8'}`}
    />
  )
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-500">
      <Spinner />
      <p>{texto}</p>
    </div>
  )
}

export function EstadoVazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-4 py-14 text-center">
      <div className="text-4xl" aria-hidden>
        📭
      </div>
      <p className="text-lg font-semibold text-slate-700">{titulo}</p>
      {children && <div className="text-slate-500">{children}</div>}
    </div>
  )
}

export function EstadoErro({ mensagem, aoTentarDeNovo }: { mensagem: string; aoTentarDeNovo?: () => void }) {
  return (
    <div role="alert" className="mx-auto my-6 flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-center">
      <p className="font-semibold text-rose-800">Algo deu errado</p>
      <p className="text-sm text-rose-700">{mensagem}</p>
      {aoTentarDeNovo && (
        <Botao variante="secundario" onClick={aoTentarDeNovo}>
          Tentar de novo
        </Botao>
      )}
    </div>
  )
}

export function BadgeStatus({ status }: { status: Status }) {
  return status === 'ativo' ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-semibold text-emerald-800">
      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
      Ativo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-sm font-semibold text-rose-700">
      <span className="h-2 w-2 rounded-full bg-rose-400" aria-hidden />
      Inativo
    </span>
  )
}

export function Modal({
  aberto,
  titulo,
  aoFechar,
  children,
}: {
  aberto: boolean
  titulo: string
  aoFechar: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (aberto && !d.open) d.showModal()
    if (!aberto && d.open) d.close()
  }, [aberto])

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault()
        aoFechar()
      }}
      className="m-auto w-[calc(100%-1.5rem)] max-w-md rounded-2xl p-0 shadow-xl backdrop:bg-slate-900/50"
    >
      {aberto && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold text-slate-900">{titulo}</h2>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="-m-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl text-slate-500 hover:bg-slate-100"
            >
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export function Cartao({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>
}

export function Pagina({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-28 pt-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900">{titulo}</h1>
        {acao}
      </div>
      {children}
    </div>
  )
}
