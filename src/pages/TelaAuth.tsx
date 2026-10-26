import type { ReactNode } from 'react'

export function TelaAuth({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/marca/logo-loogirio.png" alt="LoogiRio" className="mx-auto h-14 w-auto" />
          <div className="mx-auto mt-3 h-[3px] w-16 rounded-full bg-orange-600" aria-hidden />
          <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.25em] text-slate-500">Levando o futuro até você</p>
          <h1 className="mt-7 text-[28px] font-bold tracking-[-0.03em] text-slate-900">{titulo}</h1>
          {subtitulo && <p className="mt-1 text-[15px] text-slate-500">{subtitulo}</p>}
        </div>
        <div>{children}</div>
      </div>
    </div>
  )
}
