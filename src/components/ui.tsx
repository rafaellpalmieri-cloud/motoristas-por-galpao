import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import type { Status } from '../lib/tipos'

type Variante = 'primario' | 'secundario' | 'perigo' | 'sucesso' | 'fantasma'

// Botões no estilo iOS: preenchido (azul/vermelho/verde) ou "cinza translúcido" com texto colorido.
const estilosVariante: Record<Variante, string> = {
  primario: 'bg-sky-600 text-white active:opacity-80',
  secundario: 'bg-[rgb(118_118_128/0.12)] text-sky-700 active:bg-[rgb(118_118_128/0.2)]',
  perigo: 'bg-rose-600 text-white active:opacity-80',
  sucesso: 'bg-emerald-500 text-white active:opacity-80',
  fantasma: 'bg-transparent text-sky-700 active:opacity-60',
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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-[17px] font-semibold tracking-[-0.02em] transition duration-200 ease-ios active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:cursor-not-allowed disabled:opacity-40 ${estilosVariante[variante]} ${className}`}
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="px-1 text-[13px] font-medium uppercase tracking-wide text-slate-500">
        {rotulo}
      </label>
      <input
        id={id}
        maxLength={200}
        {...resto}
        className="min-h-11 rounded-xl border border-transparent bg-white px-4 py-2.5 text-[17px] text-slate-900 shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.08)] placeholder:text-slate-400 focus:border-sky-600 focus:outline-none focus:ring-4 focus:ring-sky-100"
      />
      {dica && !erro && <p className="px-1 text-[13px] text-slate-500">{dica}</p>}
      {erro && <p className="px-1 text-[13px] text-rose-700">{erro}</p>}
    </div>
  )
}

export function Spinner({ pequeno = false }: { pequeno?: boolean }) {
  return (
    <span
      role="status"
      aria-label="Carregando"
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent opacity-70 ${pequeno ? 'h-4 w-4' : 'h-7 w-7'}`}
    />
  )
}

export function Carregando({ texto = 'Carregando…' }: { texto?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-slate-400">
      <Spinner />
      <p className="text-[15px]">{texto}</p>
    </div>
  )
}

export function EstadoVazio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm animate-entrar flex-col items-center gap-2 px-4 py-14 text-center">
      <svg aria-hidden viewBox="0 0 24 24" className="mb-1 h-12 w-12 text-slate-300" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M3 13h4l2 3h6l2-3h4M5 13l2-8h10l2 8v6a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-6Z" strokeLinejoin="round" />
      </svg>
      <p className="text-[20px] font-semibold tracking-tight text-slate-800">{titulo}</p>
      {children && <div className="text-[15px] text-slate-500">{children}</div>}
    </div>
  )
}

export function EstadoErro({ mensagem, aoTentarDeNovo }: { mensagem: string; aoTentarDeNovo?: () => void }) {
  return (
    <div role="alert" className="mx-auto my-6 flex max-w-sm animate-entrar flex-col items-center gap-3 rounded-2xl bg-white p-6 text-center">
      <p className="text-[17px] font-semibold text-slate-900">Algo deu errado</p>
      <p className="text-[15px] text-slate-500">{mensagem}</p>
      {aoTentarDeNovo && (
        <Botao variante="secundario" onClick={aoTentarDeNovo}>
          Tentar de novo
        </Botao>
      )}
    </div>
  )
}

export function BadgeStatus({ status, pausado = false }: { status: Status; pausado?: boolean }) {
  if (pausado && status === 'inativo')
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[13px] font-semibold text-amber-800">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
        Pausado
      </span>
    )
  return status === 'ativo' ? (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[13px] font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
      Ativo
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[13px] font-semibold text-rose-700">
      <span className="h-1.5 w-1.5 rounded-full bg-rose-600" aria-hidden />
      Inativo
    </span>
  )
}

/** Marca mudanças que vieram da planilha interna (Google Sheets). */
export function SeloPlanilha() {
  return <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-800">Planilha</span>
}

/** Janela: no celular sobe de baixo (folha), no computador fica centralizada. */
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
      onClick={(e) => {
        // Toque fora da janela fecha (como no iOS).
        if (e.target === e.currentTarget) aoFechar()
      }}
      className="folha mx-0 mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[20px] bg-slate-50 p-0 shadow-2xl sm:m-auto sm:max-w-md sm:rounded-[20px]"
    >
      {aberto && (
        <div className="flex flex-col gap-4 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
          <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-300 sm:hidden" aria-hidden />
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[20px] font-bold tracking-tight text-slate-900">{titulo}</h2>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar"
              className="-mr-1 flex h-11 w-11 items-center justify-center rounded-full"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgb(118_118_128/0.12)] text-slate-500">
                <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M2 2l8 8M10 2l-8 8" />
                </svg>
              </span>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  )
}

export function Cartao({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-white p-4 ${className}`}>{children}</div>
}

/** Página com título grande (estilo "Large Title" do iOS). */
export function Pagina({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-3xl animate-esmaecer px-4 pb-32 pt-3">
      <div className="mb-4 flex items-end justify-between gap-3">
        <h1 className="text-[34px] font-bold leading-tight tracking-[-0.03em] text-slate-900">{titulo}</h1>
        {acao}
      </div>
      {children}
    </div>
  )
}
