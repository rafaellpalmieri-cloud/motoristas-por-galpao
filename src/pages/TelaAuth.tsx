import type { ReactNode } from 'react'

export function TelaAuth({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-sky-50 to-white px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/icons/icon.svg" alt="" className="mx-auto mb-3 h-16 w-16" />
          <h1 className="text-2xl font-bold text-slate-900">{titulo}</h1>
          {subtitulo && <p className="mt-1 text-slate-600">{subtitulo}</p>}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">{children}</div>
      </div>
    </div>
  )
}
