import type { ReactNode } from 'react'
import { BotaoTema } from '../components/BotaoTema'

/** Telas de entrada (login, senha): cartão da marca LoogiRio no topo e o formulário embaixo. */
export function TelaAuth({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <BotaoTema className="absolute right-3 top-3 text-sky-600" />
      <div className="w-full max-w-sm animate-entrar">
        <div className="relative mb-7 overflow-hidden rounded-[22px] bg-marinho px-6 pb-6 pt-7 text-center">
          {/* Brilho suave nas cores da marca, sem exagero. */}
          <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-laranja/25 blur-3xl" aria-hidden />
          <div className="pointer-events-none absolute -bottom-14 -left-10 h-40 w-40 rounded-full bg-sky-600/40 blur-3xl" aria-hidden />
          <img src="/marca/logo-loogirio-branco.png" alt="LoogiRio" className="relative mx-auto h-12 w-auto" />
          <div className="relative mx-auto mt-3 h-[3px] w-16 rounded-full bg-gradient-to-r from-laranja to-amarelo" aria-hidden />
          <p className="relative mt-2 text-[11px] font-medium uppercase tracking-[0.25em] text-white/70">Levando o futuro até você</p>
        </div>
        <div className="mb-6 text-center">
          <h1 className="text-[28px] font-bold tracking-[-0.03em] text-slate-900">{titulo}</h1>
          {subtitulo && <p className="mt-1 text-[15px] text-slate-500">{subtitulo}</p>}
        </div>
        <div>{children}</div>
      </div>
    </div>
  )
}
