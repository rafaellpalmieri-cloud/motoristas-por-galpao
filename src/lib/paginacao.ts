/** O PostgREST devolve no máximo 1000 linhas por requisição; busca em páginas. */
export async function buscarTodas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>,
  tamanho = 1000,
): Promise<T[]> {
  const todas: T[] = []
  for (let de = 0; ; de += tamanho) {
    const resposta = await pagina(de, de + tamanho - 1)
    if (resposta.error) throw resposta.error
    const data = resposta.data as T[] | null
    todas.push(...(data ?? []))
    if (!data || data.length < tamanho) return todas
  }
}
