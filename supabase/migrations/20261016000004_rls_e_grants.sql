-- =====================================================================
-- Políticas RLS e privilégios
-- Regra geral: anon não acessa nada; authenticated passa pela RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Privilégios: revoga tudo de anon (inclusive para objetos futuros)
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon, public;

-- authenticated: só o necessário; a RLS decide as linhas.
revoke all on all tables in schema public from authenticated;
grant select, insert, update, delete on public.perfis             to authenticated;
grant select, insert, update, delete on public.user_roles         to authenticated;
grant select, insert, update, delete on public.dispatcher_galpoes to authenticated;
grant select, insert, update, delete on public.motoristas         to authenticated;
grant select                         on public.motorista_historico to authenticated;

-- Funções chamadas pelo app ou usadas nas políticas.
grant execute on function public.galpoes_validos()                            to authenticated;
grant execute on function public.eh_admin()                                   to authenticated;
grant execute on function public.pode_gerir_galpao(text)                      to authenticated;
grant execute on function public.alterar_status_motorista(uuid, text, text, text) to authenticated;
grant execute on function public.importar_motoristas(jsonb)                   to authenticated;
grant execute on function public.exportar_motoristas()                        to authenticated;
grant execute on function public.resumo_por_galpao()                          to authenticated;
grant execute on function public.marcar_senha_trocada()                       to authenticated;
grant execute on function public.marcar_alertas_vistos()                      to authenticated;
-- has_role, usuario_ativo e converter_data_csv ficam só para uso interno.

-- ---------------------------------------------------------------------
-- motoristas: leitura pelo galpão; escrita direta só admin.
-- Dispatcher altera status apenas via alterar_status_motorista().
-- ---------------------------------------------------------------------
create policy motoristas_select on public.motoristas
  for select to authenticated
  using (public.pode_gerir_galpao(galpao));

create policy motoristas_admin_insert on public.motoristas
  for insert to authenticated
  with check (public.eh_admin());

create policy motoristas_admin_update on public.motoristas
  for update to authenticated
  using (public.eh_admin())
  with check (public.eh_admin());

create policy motoristas_admin_delete on public.motoristas
  for delete to authenticated
  using (public.eh_admin());

-- ---------------------------------------------------------------------
-- motorista_historico: só leitura, pelo galpão registrado.
-- ---------------------------------------------------------------------
create policy historico_select on public.motorista_historico
  for select to authenticated
  using (public.pode_gerir_galpao(galpao));

-- ---------------------------------------------------------------------
-- perfis / user_roles / dispatcher_galpoes:
-- cada um lê o próprio; admin lê e gerencia todos.
-- ---------------------------------------------------------------------
create policy perfis_select on public.perfis
  for select to authenticated
  using (user_id = (select auth.uid()) or public.eh_admin());

create policy perfis_admin_insert on public.perfis
  for insert to authenticated with check (public.eh_admin());

create policy perfis_admin_update on public.perfis
  for update to authenticated using (public.eh_admin()) with check (public.eh_admin());

create policy perfis_admin_delete on public.perfis
  for delete to authenticated using (public.eh_admin());

create policy user_roles_select on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.eh_admin());

create policy user_roles_admin_insert on public.user_roles
  for insert to authenticated with check (public.eh_admin());

create policy user_roles_admin_update on public.user_roles
  for update to authenticated using (public.eh_admin()) with check (public.eh_admin());

create policy user_roles_admin_delete on public.user_roles
  for delete to authenticated using (public.eh_admin());

create policy dispatcher_galpoes_select on public.dispatcher_galpoes
  for select to authenticated
  using (user_id = (select auth.uid()) or public.eh_admin());

create policy dispatcher_galpoes_admin_insert on public.dispatcher_galpoes
  for insert to authenticated with check (public.eh_admin());

create policy dispatcher_galpoes_admin_update on public.dispatcher_galpoes
  for update to authenticated using (public.eh_admin()) with check (public.eh_admin());

create policy dispatcher_galpoes_admin_delete on public.dispatcher_galpoes
  for delete to authenticated using (public.eh_admin());
