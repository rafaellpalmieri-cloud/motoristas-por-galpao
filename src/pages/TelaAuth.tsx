import type { ReactNode } from 'react'

export function TelaAuth({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-marinho px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/marca/logo-branca.png" alt="LoogiRio" className="mx-auto h-14 w-auto" />
          <div className="mx-auto mt-3 h-1 w-24 rounded-full bg-gradient-to-r from-laranja to-amarelo" aria-hidden />
          <h1 className="mt-4 text-2xl font-bold text-white">{titulo}</h1>
          {subtitulo && <p className="mt-1 text-white/70">{subtitulo}</p>}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</div>
      </div>
    </div>
  )
}
