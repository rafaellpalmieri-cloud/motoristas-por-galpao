import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../../auth/AuthProvider'
import { IconeTelefone } from '../../components/Icones'
import { useToast } from '../../components/Toast'
import { Botao, Campo, Carregando, EstadoErro, EstadoVazio, Modal, Pagina } from '../../components/ui'
import { GALPOES } from '../../lib/constantes'
import { formatarDataHora, tempoRelativo } from '../../lib/datas'
import { mensagemErro, mensagemErroFuncao } from '../../lib/erros'
import { supabase } from '../../lib/supabase'
import { formatarCelular, linkTelefone, linkWhatsApp } from '../../lib/telefone'
import type { Papel, Perfil } from '../../lib/tipos'

interface Usuario extends Perfil {
  papeis: Papel[]
  galpoes: string[]
}

function useUsuarios() {
  return useQuery({
    queryKey: ['admin', 'usuarios'],
    queryFn: async (): Promise<Usuario[]> => {
      const [perfis, papeis, galpoes] = await Promise.all([
        supabase
          .from('perfis')
          .select('user_id, nome, email, telefone, ativo, trocar_senha, alertas_vistos_em, ultimo_acesso')
          .order('nome'),
        supabase.from('user_roles').select('user_id, role'),
        supabase.from('dispatcher_galpoes').select('user_id, galpao'),
      ])
      if (perfis.error) throw perfis.error
      if (papeis.error) throw papeis.error
      if (galpoes.error) throw galpoes.error
      return (perfis.data as Perfil[]).map((p) => ({
        ...p,
        papeis: papeis.data.filter((r) => r.user_id === p.user_id).map((r) => r.role as Papel),
        galpoes: galpoes.data
          .filter((g) => g.user_id === p.user_id)
          .map((g) => g.galpao as string)
          .sort((a, b) => GALPOES.indexOf(a as never) - GALPOES.indexOf(b as never)),
      }))
    },
  })
}

/** Telefone do usuário com atalhos para ligar e chamar no WhatsApp. */
function Contato({ telefone, nome }: { telefone: string | null; nome: string }) {
  const tel = linkTelefone(telefone)
  const wa = linkWhatsApp(telefone)
  if (!tel) return <p className="mt-2 text-sm text-slate-400">Sem telefone cadastrado</p>
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <a
        href={tel}
        aria-label={`Ligar para ${nome}`}
        className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-slate-300 px-3 text-sm text-slate-800 hover:bg-slate-50"
      >
        <IconeTelefone className="h-4 w-4 text-sky-600" /> {formatarCelular(telefone)}
      </a>
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-xl border border-emerald-300 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
        >
          WhatsApp
        </a>
      )}
    </div>
  )
}

async function chamarFuncao<T>(nome: string, corpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nome, { body: corpo })
  if (error) throw new Error(await mensagemErroFuncao(error))
  return data as T
}

function SeletorGalpoes({ valor, aoMudar }: { valor: string[]; aoMudar: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-700">Galpões *</legend>
      <div className="grid grid-cols-3 gap-2">
        {GALPOES.map((g) => {
          const marcado = valor.includes(g)
          return (
            <label
              key={g}
              className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border text-sm font-semibold ${marcado ? 'border-sky-600 bg-sky-50 text-sky-900' : 'border-slate-300 text-slate-700'}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={marcado}
                onChange={() => aoMudar(marcado ? valor.filter((x) => x !== g) : [...valor, g])}
              />
              {g}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

function SenhaTemporaria({ email, senha, aoFechar }: { email: string; senha: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false)
  return (
    <div className="flex flex-col gap-4">
      <p className="text-slate-700">
        Repasse a senha temporária para <strong>{email}</strong>. Ela <strong>não será mostrada de novo</strong>. No primeiro
        acesso o app vai pedir para trocar.
      </p>
      <p className="select-all rounded-xl bg-slate-100 p-4 text-center font-mono text-2xl tracking-wider text-slate-900">{senha}</p>
      <div className="grid grid-cols-2 gap-3">
        <Botao
          variante="secundario"
          onClick={async () => {
            await navigator.clipboard.writeText(senha)
            setCopiado(true)
          }}
        >
          {copiado ? 'Copiado ✓' : 'Copiar'}
        </Botao>
        <Botao onClick={aoFechar}>Já anotei</Botao>
      </div>
    </div>
  )
}

function SeletorPapel({ valor, aoMudar }: { valor: Papel; aoMudar: (p: Papel) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-slate-700">Tipo de acesso *</legend>
      <div className="grid grid-cols-2 gap-2">
        {(
          [
            ['dispatcher', 'Dispatcher', 'Só os galpões marcados'],
            ['admin', 'Admin', 'Tudo, inclusive equipe e CSV'],
          ] as const
        ).map(([p, rotulo, dica]) => (
          <label
            key={p}
            className={`flex min-h-14 cursor-pointer flex-col items-center justify-center rounded-xl border px-2 text-center ${valor === p ? 'border-sky-600 bg-sky-50 text-sky-900' : 'border-slate-300 text-slate-700'}`}
          >
            <input type="radio" name="papel" className="sr-only" checked={valor === p} onChange={() => aoMudar(p)} />
            <span className="font-semibold">{rotulo}</span>
            <span className="text-xs text-slate-500">{dica}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function soDigitos(valor: string) {
  return valor.replace(/\D/g, '')
}

function telefoneValido(valor: string) {
  const d = soDigitos(valor)
  return d.length >= 10 && d.length <= 13
}

function FormNovo({ aoCriar }: { aoCriar: (email: string, senha: string) => void }) {
  const [papel, setPapel] = useState<Papel>('dispatcher')
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [telefone, setTelefone] = useState('')
  const [galpoes, setGalpoes] = useState<string[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const criar = useMutation({
    mutationFn: () =>
      chamarFuncao<{ senha_temporaria: string; email: string }>('admin-criar-usuario', {
        papel,
        nome,
        email,
        telefone: soDigitos(telefone),
        galpoes: papel === 'dispatcher' ? galpoes : [],
      }),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'usuarios'] })
      aoCriar(r.email, r.senha_temporaria)
    },
    onError: (e) => setErro(mensagemErro(e)),
  })

  function enviar(e: FormEvent) {
    e.preventDefault()
    if (papel === 'dispatcher' && !telefone.trim()) return setErro('Informe o telefone com DDD.')
    if (telefone.trim() && !telefoneValido(telefone)) return setErro('Telefone inválido. Use DDD + número.')
    if (papel === 'dispatcher' && !galpoes.length) return setErro('Selecione ao menos um galpão.')
    setErro(null)
    criar.mutate()
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-4">
      <SeletorPapel valor={papel} aoMudar={setPapel} />
      <Campo rotulo="Nome *" required value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
      <Campo
        rotulo="E-mail *"
        type="email"
        inputMode="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="off"
      />
      <Campo
        rotulo={papel === 'dispatcher' ? 'Telefone (WhatsApp) *' : 'Telefone (WhatsApp)'}
        type="tel"
        inputMode="tel"
        placeholder="(21) 99999-9999"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
        autoComplete="off"
      />
      {papel === 'dispatcher' ? (
        <SeletorGalpoes valor={galpoes} aoMudar={setGalpoes} />
      ) : (
        <p className="rounded-xl bg-sky-50 p-3 text-sm text-sky-900">
          Admin vê todos os galpões e pode gerenciar a equipe, importar e exportar CSV.
        </p>
      )}
      {erro && <p className="text-sm text-rose-700">{erro}</p>}
      <Botao type="submit" carregando={criar.isPending}>
        {papel === 'admin' ? 'Criar admin' : 'Criar dispatcher'}
      </Botao>
    </form>
  )
}

function FormEditar({ usuario, aoFechar }: { usuario: Usuario; aoFechar: () => void }) {
  const ehDispatcher = !usuario.papeis.includes('admin')
  const [telefone, setTelefone] = useState(usuario.telefone ?? '')
  const [galpoes, setGalpoes] = useState(usuario.galpoes)
  const [erro, setErro] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const toast = useToast()
  const salvar = useMutation({
    mutationFn: async () => {
      const novoTelefone = soDigitos(telefone) || null
      if (novoTelefone !== (usuario.telefone ?? null)) {
        const { error } = await supabase.from('perfis').update({ telefone: novoTelefone }).eq('user_id', usuario.user_id)
        if (error) throw error
      }
      if (!ehDispatcher) return
      const remover = usuario.galpoes.filter((g) => !galpoes.includes(g))
      const adicionar = galpoes.filter((g) => !usuario.galpoes.includes(g))
      if (adicionar.length) {
        const { error } = await supabase
          .from('dispatcher_galpoes')
          .insert(adicionar.map((galpao) => ({ user_id: usuario.user_id, galpao })))
        if (error) throw error
      }
      if (remover.length) {
        const { error } = await supabase
          .from('dispatcher_galpoes')
          .delete()
          .eq('user_id', usuario.user_id)
          .in('galpao', remover)
        if (error) throw error
      }
    },
    onSuccess: () => {
      toast('Dados atualizados.', 'sucesso')
      aoFechar()
    },
    onError: (e) => setErro(mensagemErro(e)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'usuarios'] }),
  })

  function confirmar() {
    if (ehDispatcher && !telefone.trim()) return setErro('Informe o telefone com DDD.')
    if (telefone.trim() && !telefoneValido(telefone)) return setErro('Telefone inválido. Use DDD + número.')
    if (ehDispatcher && !galpoes.length) return setErro('Selecione ao menos um galpão.')
    setErro(null)
    salvar.mutate()
  }

  return (
    <div className="flex flex-col gap-4">
      <Campo
        rotulo={ehDispatcher ? 'Telefone (WhatsApp) *' : 'Telefone (WhatsApp)'}
        type="tel"
        inputMode="tel"
        placeholder="(21) 99999-9999"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
      />
      {ehDispatcher && <SeletorGalpoes valor={galpoes} aoMudar={setGalpoes} />}
      {erro && <p className="text-sm text-rose-700">{erro}</p>}
      <div className="grid grid-cols-2 gap-3">
        <Botao variante="secundario" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao carregando={salvar.isPending} onClick={confirmar}>
          Salvar
        </Botao>
      </div>
    </div>
  )
}

type Acao = { tipo: 'desativar' | 'reativar' | 'redefinir_senha'; usuario: Usuario }

function ConfirmarAcao({
  acao,
  aoFechar,
  aoSenha,
}: {
  acao: Acao
  aoFechar: () => void
  aoSenha: (email: string, senha: string) => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const executar = useMutation({
    mutationFn: () =>
      chamarFuncao<{ senha_temporaria?: string }>('admin-gerir-usuario', { acao: acao.tipo, user_id: acao.usuario.user_id }),
    onSuccess: (r) => {
      if (r.senha_temporaria) aoSenha(acao.usuario.email, r.senha_temporaria)
      else {
        toast(acao.tipo === 'desativar' ? 'Usuário desativado.' : 'Usuário reativado.', 'sucesso')
        aoFechar()
      }
    },
    onError: (e) => toast(mensagemErro(e), 'erro'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['admin', 'usuarios'] }),
  })
  const textos = {
    desativar: ['Desativar', 'não conseguirá mais entrar no app.'],
    reativar: ['Reativar', 'voltará a ter acesso ao app.'],
    redefinir_senha: ['Gerar nova senha', 'receberá uma nova senha temporária e terá de trocá-la no próximo acesso.'],
  }[acao.tipo]

  return (
    <div className="flex flex-col gap-4">
      <p className="text-slate-700">
        <strong>{acao.usuario.nome}</strong> {textos[1]}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Botao variante="secundario" onClick={aoFechar}>
          Cancelar
        </Botao>
        <Botao
          variante={acao.tipo === 'desativar' ? 'perigo' : 'primario'}
          carregando={executar.isPending}
          onClick={() => executar.mutate()}
        >
          {textos[0]}
        </Botao>
      </div>
    </div>
  )
}

export default function Dispatchers() {
  const { session } = useAuth()
  const { data, isPending, error, refetch } = useUsuarios()
  const [novoAberto, setNovoAberto] = useState(false)
  const [editando, setEditando] = useState<Usuario | null>(null)
  const [acao, setAcao] = useState<Acao | null>(null)
  const [senha, setSenha] = useState<{ email: string; senha: string } | null>(null)

  const mostrarSenha = (email: string, s: string) => {
    setNovoAberto(false)
    setAcao(null)
    setSenha({ email, senha: s })
  }

  return (
    <Pagina titulo="Equipe" acao={<Botao onClick={() => setNovoAberto(true)}>+ Novo</Botao>}>
      {isPending ? (
        <Carregando />
      ) : error ? (
        <EstadoErro mensagem={mensagemErro(error)} aoTentarDeNovo={() => refetch()} />
      ) : data.length === 0 ? (
        <EstadoVazio titulo="Nenhum usuário cadastrado" />
      ) : (
        <ul className="flex flex-col gap-3">
          {data.map((u) => {
            const ehAdmin = u.papeis.includes('admin')
            const souEu = u.user_id === session?.user.id
            return (
              <li
                key={u.user_id}
                className={`rounded-2xl border bg-white p-4 shadow-sm ${u.ativo ? 'border-slate-200' : 'border-slate-200 opacity-70'}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-900">
                      {u.nome} {souEu && <span className="text-sm font-normal text-slate-500">(você)</span>}
                    </p>
                    <p className="truncate text-sm text-slate-500">{u.email}</p>
                    <p className={`text-xs ${u.ultimo_acesso ? 'text-slate-500' : 'text-amber-700'}`}>
                      {u.ultimo_acesso
                        ? `Último acesso ${tempoRelativo(u.ultimo_acesso)} (${formatarDataHora(u.ultimo_acesso)})`
                        : 'Ainda não acessou o app'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-xs font-bold">
                    {ehAdmin && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-sky-800">ADMIN</span>}
                    {!u.ativo && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-700">DESATIVADO</span>}
                    {u.ativo && u.trocar_senha && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">SENHA PENDENTE</span>
                    )}
                  </div>
                </div>
                {!ehAdmin && (
                  <p className="mt-2 text-sm text-slate-700">
                    Galpões: <strong>{u.galpoes.length ? u.galpoes.join(', ') : 'nenhum'}</strong>
                  </p>
                )}
                <Contato telefone={u.telefone} nome={u.nome} />
                <div className="mt-3 flex flex-wrap gap-2">
                  <Botao variante="secundario" onClick={() => setEditando(u)}>
                    Editar
                  </Botao>
                  {!souEu && (
                    <>
                    <Botao variante="secundario" onClick={() => setAcao({ tipo: 'redefinir_senha', usuario: u })}>
                      Nova senha
                    </Botao>
                    {u.ativo ? (
                      <Botao variante="secundario" className="text-rose-700" onClick={() => setAcao({ tipo: 'desativar', usuario: u })}>
                        Desativar
                      </Botao>
                    ) : (
                      <Botao variante="secundario" className="text-emerald-700" onClick={() => setAcao({ tipo: 'reativar', usuario: u })}>
                        Reativar
                      </Botao>
                    )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Modal aberto={novoAberto} titulo="Novo usuário" aoFechar={() => setNovoAberto(false)}>
        <FormNovo aoCriar={mostrarSenha} />
      </Modal>
      <Modal aberto={!!editando} titulo={`Editar ${editando?.nome ?? ''}`} aoFechar={() => setEditando(null)}>
        {editando && <FormEditar key={editando.user_id} usuario={editando} aoFechar={() => setEditando(null)} />}
      </Modal>
      <Modal aberto={!!acao} titulo="Confirmar" aoFechar={() => setAcao(null)}>
        {acao && <ConfirmarAcao acao={acao} aoFechar={() => setAcao(null)} aoSenha={mostrarSenha} />}
      </Modal>
      <Modal aberto={!!senha} titulo="Senha temporária" aoFechar={() => setSenha(null)}>
        {senha && <SenhaTemporaria email={senha.email} senha={senha.senha} aoFechar={() => setSenha(null)} />}
      </Modal>
    </Pagina>
  )
}
