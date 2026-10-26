import { trocarTema, useTema } from '../lib/tema'
import { IconeLua, IconeSol } from './Icones'

/** Alterna entre tema claro e escuro (a escolha fica salva no aparelho). */
export function BotaoTema({ className = '' }: { className?: string }) {
  const tema = useTema()
  const escuro = tema === 'escuro'
  return (
    <button
      type="button"
      onClick={trocarTema}
      aria-label={escuro ? 'Usar tema claro' : 'Usar tema escuro'}
      title={escuro ? 'Tema claro' : 'Tema escuro'}
      className={`flex h-11 w-11 items-center justify-center rounded-full active:opacity-60 ${className}`}
    >
      {escuro ? <IconeSol className="h-6 w-6" /> : <IconeLua className="h-[22px] w-[22px]" />}
    </button>
  )
}
