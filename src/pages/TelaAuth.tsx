import type { ReactNode } from 'react'

export function TelaAuth({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <img src="/icons/icon.svg" alt="" className="mx-auto mb-4 h-20 w-20 rounded-[22px] shadow-sm" />
          <h1 className="text-[28px] font-bold tracking-[-0.03em] text-slate-900">{titulo}</h1>
          {subtitulo && <p className="mt-1 text-[15px] text-slate-500">{subtitulo}</p>}
        </div>
        <div>{children}</div>
      </div>
    </div>
  )
}
