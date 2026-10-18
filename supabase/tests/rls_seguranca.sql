-- =====================================================================
-- Testes de segurança (RLS e funções) — Motoristas por Galpão
--
-- Como rodar:
--   a) Local, sem Docker:   npm run test:rls
--   b) No projeto Supabase: cole tudo no SQL Editor e clique em Run.
--      Tudo roda dentro de BEGIN ... ROLLBACK: nada fica gravado.
--
-- Cada verificação imprime "OK: ..." (aba de mensagens/NOTICE).
-- Se algo falhar, o script para com "FALHOU: ...".
--
-- Usuários e motoristas abaixo são FICTÍCIOS.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Preparação (como postgres)
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000001', 'admin.teste@exemplo.test'),
  ('00000000-0000-4000-a000-000000000002', 'disp.srj1@exemplo.test'),
  ('00000000-0000-4000-a000-000000000003', 'disp.srj2@exemplo.test'),
  ('00000000-0000-4000-a000-000000000004', 'disp.desativado@exemplo.test');

insert into public.perfis (user_id, nome, email, ativo, trocar_senha, alertas_vistos_em) values
  ('00000000-0000-4000-a000-000000000001', 'Admin Teste',      'admin.teste@exemplo.test',      true,  false, now() - interval '1 day'),
  ('00000000-0000-4000-a000-000000000002', 'Dispatcher SRJ1',  'disp.srj1@exemplo.test',        true,  false, now() - interval '1 day'),
  ('00000000-0000-4000-a000-000000000003', 'Dispatcher SRJ2',  'disp.srj2@exemplo.test',        true,  false, now() - interval '1 day'),
  ('00000000-0000-4000-a000-000000000004', 'Disp Desativado',  'disp.desativado@exemplo.test',  false, false, now() - interval '1 day');

insert into public.user_roles (user_id, role) values
  ('00000000-0000-4000-a000-000000000001', 'admin'),
  ('00000000-0000-4000-a000-000000000002', 'dispatcher'),
  ('00000000-0000-4000-a000-000000000003', 'dispatcher'),
  ('00000000-0000-4000-a000-000000000004', 'dispatcher');

insert into public.dispatcher_galpoes (user_id, galpao) values
  ('00000000-0000-4000-a000-000000000002', 'SRJ1'),
  ('00000000-0000-4000-a000-000000000003', 'SRJ2'),
  ('00000000-0000-4000-a000-000000000004', 'SRJ1');

insert into public.motoristas (id, codigo, nome_completo, celular, placa, modal, galpao, status) values
  ('10000000-0000-4000-a000-000000000001', 'TESTE-SRJ1', 'Motorista Ficticio Um',   '21900000101', 'TST0001', 'Moto',  'SRJ1', 'ativo'),
  ('10000000-0000-4000-a000-000000000002', 'TESTE-SRJ2', 'Motorista Ficticio Dois', '21900000102', 'TST0002', 'Carro', 'SRJ2', 'ativo'),
  ('10000000-0000-4000-a000-000000000003', 'TESTE-NULO', 'Motorista Sem Galpao',    '21900000103', 'TST0003', 'Van',   null,   'ativo');

-- =====================================================================
-- 1. Papel anon não lê nada
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

do $$
begin
  begin
    perform 1 from public.motoristas limit 1;
    raise exception 'FALHOU: anon conseguiu ler motoristas';
  exception when insufficient_privilege then raise notice 'OK: anon não lê motoristas';
  end;

  begin
    perform 1 from public.motorista_historico limit 1;
    raise exception 'FALHOU: anon conseguiu ler motorista_historico';
  exception when insufficient_privilege then raise notice 'OK: anon não lê histórico';
  end;

  begin
    perform 1 from public.perfis limit 1;
    raise exception 'FALHOU: anon conseguiu ler perfis';
  exception when insufficient_privilege then raise notice 'OK: anon não lê perfis';
  end;

  begin
    perform 1 from public.user_roles limit 1;
    raise exception 'FALHOU: anon conseguiu ler user_roles';
  exception when insufficient_privilege then raise notice 'OK: anon não lê user_roles';
  end;

  begin
    perform 1 from public.dispatcher_galpoes limit 1;
    raise exception 'FALHOU: anon conseguiu ler dispatcher_galpoes';
  exception when insufficient_privilege then raise notice 'OK: anon não lê dispatcher_galpoes';
  end;

  begin
    perform public.alterar_status_motorista('10000000-0000-4000-a000-000000000001', 'inativo', 'Parou de rodar', null);
    raise exception 'FALHOU: anon executou alterar_status_motorista';
  exception when insufficient_privilege then raise notice 'OK: anon não executa alterar_status_motorista';
  end;

  begin
    perform public.importar_motoristas('[]'::jsonb);
    raise exception 'FALHOU: anon executou importar_motoristas';
  exception when insufficient_privilege then raise notice 'OK: anon não executa importar_motoristas';
  end;
end;
$$;

reset role;

-- =====================================================================
-- 2. Dispatcher do SRJ1
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n integer;
begin
  -- Lê o próprio galpão
  select count(*) into n from public.motoristas where codigo = 'TESTE-SRJ1';
  if n <> 1 then raise exception 'FALHOU: dispatcher SRJ1 não vê motorista do SRJ1'; end if;
  raise notice 'OK: dispatcher SRJ1 vê motorista do SRJ1';

  -- Não lê SRJ2
  select count(*) into n from public.motoristas where codigo = 'TESTE-SRJ2';
  if n <> 0 then raise exception 'FALHOU: dispatcher SRJ1 leu motorista do SRJ2'; end if;
  raise notice 'OK: dispatcher SRJ1 não lê motorista do SRJ2';

  -- Não lê sem galpão
  select count(*) into n from public.motoristas where galpao is null;
  if n <> 0 then raise exception 'FALHOU: dispatcher SRJ1 leu motorista sem galpão'; end if;
  raise notice 'OK: dispatcher SRJ1 não lê motoristas sem galpão';

  -- Não altera SRJ2 pela função
  begin
    perform public.alterar_status_motorista('10000000-0000-4000-a000-000000000002', 'inativo', 'Parou de rodar', null);
    raise exception 'FALHOU: dispatcher SRJ1 inativou motorista do SRJ2';
  exception when insufficient_privilege then raise notice 'OK: dispatcher SRJ1 não altera motorista do SRJ2';
  end;

  -- UPDATE direto não afeta nenhuma linha (nem do próprio galpão)
  update public.motoristas set status = 'inativo' where codigo in ('TESTE-SRJ1', 'TESTE-SRJ2');
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: UPDATE direto em motoristas alterou % linha(s)', n; end if;
  raise notice 'OK: UPDATE direto em motoristas não altera nada';

  -- DELETE direto não afeta nenhuma linha
  delete from public.motoristas where codigo = 'TESTE-SRJ1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: DELETE direto em motoristas apagou % linha(s)', n; end if;
  raise notice 'OK: DELETE direto em motoristas não apaga nada';

  -- INSERT direto é bloqueado
  begin
    insert into public.motoristas (codigo, nome_completo, galpao, status) values ('TESTE-INVASOR', 'X', 'SRJ1', 'ativo');
    raise exception 'FALHOU: dispatcher inseriu motorista diretamente';
  exception when insufficient_privilege then raise notice 'OK: INSERT direto em motoristas é bloqueado';
  end;

  -- INSERT direto no histórico é bloqueado
  begin
    insert into public.motorista_historico (motorista_id, galpao, status_novo) values ('10000000-0000-4000-a000-000000000001', 'SRJ1', 'inativo');
    raise exception 'FALHOU: dispatcher gravou histórico diretamente';
  exception when insufficient_privilege then raise notice 'OK: escrita direta no histórico é bloqueada';
  end;

  -- user_roles: só o próprio
  select count(*) into n from public.user_roles where user_id <> '00000000-0000-4000-a000-000000000002';
  if n <> 0 then raise exception 'FALHOU: dispatcher leu user_roles de outros'; end if;
  select count(*) into n from public.user_roles;
  if n <> 1 then raise exception 'FALHOU: dispatcher não lê o próprio user_roles'; end if;
  raise notice 'OK: dispatcher lê só o próprio user_roles';

  -- perfis e dispatcher_galpoes: só o próprio
  select count(*) into n from public.perfis where user_id <> '00000000-0000-4000-a000-000000000002';
  if n <> 0 then raise exception 'FALHOU: dispatcher leu perfis de outros'; end if;
  select count(*) into n from public.dispatcher_galpoes where user_id <> '00000000-0000-4000-a000-000000000002';
  if n <> 0 then raise exception 'FALHOU: dispatcher leu galpões de outros'; end if;
  raise notice 'OK: dispatcher lê só o próprio perfil e os próprios galpões';

  -- Não consegue se promover a admin
  begin
    insert into public.user_roles (user_id, role) values ('00000000-0000-4000-a000-000000000002', 'admin');
    raise exception 'FALHOU: dispatcher se promoveu a admin';
  exception when insufficient_privilege then raise notice 'OK: dispatcher não se promove a admin';
  end;

  -- Não consegue se vincular a outro galpão
  begin
    insert into public.dispatcher_galpoes (user_id, galpao) values ('00000000-0000-4000-a000-000000000002', 'SRJ2');
    raise exception 'FALHOU: dispatcher se vinculou a outro galpão';
  exception when insufficient_privilege then raise notice 'OK: dispatcher não se vincula a outro galpão';
  end;

  -- Não consegue se reativar / editar perfil
  update public.perfis set ativo = true, trocar_senha = false where user_id = '00000000-0000-4000-a000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: dispatcher editou o próprio perfil diretamente'; end if;
  raise notice 'OK: dispatcher não edita perfil diretamente';

  -- Dispatcher NÃO inativa direto (precisa de aprovação)
  begin
    perform public.alterar_status_motorista('10000000-0000-4000-a000-000000000001', 'inativo', 'Parou de rodar', null);
    raise exception 'FALHOU: dispatcher inativou direto, sem aprovação';
  exception when insufficient_privilege then raise notice 'OK: dispatcher não inativa direto (só por solicitação)';
  end;

  -- status inválido falha
  begin
    perform public.alterar_status_motorista('10000000-0000-4000-a000-000000000001', 'suspenso', null, null);
    raise exception 'FALHOU: aceitou status inválido';
  exception when invalid_parameter_value then raise notice 'OK: status inválido falha';
  end;

  -- Solicitação sem motivo falha
  begin
    perform public.solicitar_inativacao('10000000-0000-4000-a000-000000000001', null, null);
    raise exception 'FALHOU: solicitou sem motivo';
  exception when invalid_parameter_value then raise notice 'OK: solicitar inativação sem motivo falha';
  end;

  -- motivo inválido falha
  begin
    perform public.solicitar_inativacao('10000000-0000-4000-a000-000000000001', 'Qualquer coisa', null);
    raise exception 'FALHOU: aceitou motivo inválido';
  exception when invalid_parameter_value then raise notice 'OK: motivo inválido falha';
  end;

  -- "Outro" sem observação falha
  begin
    perform public.solicitar_inativacao('10000000-0000-4000-a000-000000000001', 'Outro', '   ');
    raise exception 'FALHOU: aceitou Outro sem observação';
  exception when invalid_parameter_value then raise notice 'OK: motivo Outro sem observação falha';
  end;

  -- Não solicita para motorista de outro galpão
  begin
    perform public.solicitar_inativacao('10000000-0000-4000-a000-000000000002', 'Parou de rodar', null);
    raise exception 'FALHOU: dispatcher SRJ1 solicitou inativação no SRJ2';
  exception when insufficient_privilege then raise notice 'OK: dispatcher não solicita inativação em outro galpão';
  end;

  -- Solicitação válida: fica pendente e o motorista continua ativo
  perform public.solicitar_inativacao('10000000-0000-4000-a000-000000000001', 'Parou de rodar', 'teste automatizado');
  if not exists (select 1 from public.solicitacoes_inativacao
                 where motorista_id = '10000000-0000-4000-a000-000000000001' and status = 'pendente'
                   and solicitado_por = '00000000-0000-4000-a000-000000000002' and solicitado_por_nome = 'Dispatcher SRJ1') then
    raise exception 'FALHOU: solicitação não ficou pendente';
  end if;
  if not exists (select 1 from public.motoristas where codigo = 'TESTE-SRJ1' and status = 'ativo') then
    raise exception 'FALHOU: motorista foi inativado antes da aprovação';
  end if;
  raise notice 'OK: solicitação fica pendente e o motorista continua ativo';

  -- Segunda solicitação para o mesmo motorista falha
  begin
    perform public.solicitar_inativacao('10000000-0000-4000-a000-000000000001', 'Parou de rodar', null);
    raise exception 'FALHOU: aceitou solicitação duplicada';
  exception when invalid_parameter_value then raise notice 'OK: não aceita duas solicitações pendentes';
  end;

  -- Dispatcher não aprova
  begin
    perform public.decidir_solicitacao_inativacao(
      (select id from public.solicitacoes_inativacao where status = 'pendente' limit 1), true, null);
    raise exception 'FALHOU: dispatcher aprovou solicitação';
  exception when insufficient_privilege then raise notice 'OK: dispatcher não aprova solicitação';
  end;

  -- Escrita direta na tabela de solicitações é bloqueada
  begin
    update public.solicitacoes_inativacao set status = 'aprovada';
    raise exception 'FALHOU: dispatcher alterou solicitação direto';
  exception when insufficient_privilege then raise notice 'OK: escrita direta em solicitações é bloqueada';
  end;

  -- importar_motoristas por dispatcher falha
  begin
    perform public.importar_motoristas('[{"codigo":"TESTE-X","galpao":"SRJ1","status":"ativo"}]'::jsonb);
    raise exception 'FALHOU: dispatcher importou motoristas';
  exception when insufficient_privilege then raise notice 'OK: importar_motoristas por dispatcher falha';
  end;

  -- exportar_motoristas por dispatcher falha
  begin
    perform * from public.exportar_motoristas();
    raise exception 'FALHOU: dispatcher exportou motoristas';
  exception when insufficient_privilege then raise notice 'OK: exportar_motoristas por dispatcher falha';
  end;
end;
$$;

reset role;

-- =====================================================================
-- 2b. Solicitação: outro galpão não vê; admin aprova
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000003","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  if exists (select 1 from public.solicitacoes_inativacao) then
    raise exception 'FALHOU: dispatcher SRJ2 viu solicitação do SRJ1';
  end if;
  raise notice 'OK: dispatcher de outro galpão não vê a solicitação';
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v_id bigint;
begin
  select id into v_id from public.solicitacoes_inativacao where status = 'pendente';
  if v_id is null then raise exception 'FALHOU: admin não vê a solicitação pendente'; end if;
  raise notice 'OK: admin vê a solicitação pendente';

  begin
    perform public.decidir_solicitacao_inativacao(v_id, false, '  ');
    raise exception 'FALHOU: recusou sem motivo';
  exception when invalid_parameter_value then raise notice 'OK: recusar exige motivo';
  end;

  perform public.decidir_solicitacao_inativacao(v_id, true, 'Enviado para a Coopmetro');
  if not exists (select 1 from public.motoristas where codigo = 'TESTE-SRJ1' and status = 'inativo'
                 and inativo_desde is not null and motivo_inativacao = 'Parou de rodar') then
    raise exception 'FALHOU: aprovação não inativou o motorista';
  end if;
  if not exists (select 1 from public.motorista_historico
                 where motorista_id = '10000000-0000-4000-a000-000000000001' and status_novo = 'inativo'
                   and alterado_por = '00000000-0000-4000-a000-000000000001'
                   and observacao like '%Solicitado por Dispatcher SRJ1%') then
    raise exception 'FALHOU: histórico da aprovação incompleto';
  end if;
  if not exists (select 1 from public.solicitacoes_inativacao where id = v_id and status = 'aprovada'
                 and decidido_por_nome = 'Admin Teste' and resposta = 'Enviado para a Coopmetro') then
    raise exception 'FALHOU: solicitação não marcada como aprovada';
  end if;
  raise notice 'OK: aprovação inativa o motorista, grava histórico e fecha a solicitação';

  begin
    perform public.decidir_solicitacao_inativacao(v_id, true, null);
    raise exception 'FALHOU: aprovou duas vezes';
  exception when invalid_parameter_value then raise notice 'OK: solicitação já decidida não muda de novo';
  end;
end;
$$;

reset role;

-- =====================================================================
-- 3. Dispatcher do SRJ2: não vê histórico do SRJ1; vê alerta só do SRJ2
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000003","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n integer;
begin
  select count(*) into n from public.motorista_historico
   where motorista_id = '10000000-0000-4000-a000-000000000001';
  if n <> 0 then raise exception 'FALHOU: dispatcher SRJ2 leu histórico do SRJ1'; end if;
  raise notice 'OK: dispatcher SRJ2 não lê histórico do SRJ1';

  select count(*) into n from public.motoristas where codigo = 'TESTE-SRJ1';
  if n <> 0 then raise exception 'FALHOU: dispatcher SRJ2 leu motorista do SRJ1'; end if;
  raise notice 'OK: dispatcher SRJ2 não lê motorista do SRJ1';
end;
$$;

reset role;

-- =====================================================================
-- 4. Dispatcher desativado não vê nada
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000004","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n integer;
begin
  select count(*) into n from public.motoristas;
  if n <> 0 then raise exception 'FALHOU: dispatcher desativado leu % motorista(s)', n; end if;
  raise notice 'OK: dispatcher desativado não lê motoristas';

  begin
    perform public.alterar_status_motorista('10000000-0000-4000-a000-000000000001', 'ativo', null, null);
    raise exception 'FALHOU: dispatcher desativado alterou status';
  exception when insufficient_privilege then raise notice 'OK: dispatcher desativado não altera status';
  end;
end;
$$;

reset role;

-- =====================================================================
-- 5. Admin: vê tudo, importa, reimportação não sobrescreve status
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare
  n   integer;
  r   jsonb;
  csv jsonb := '[
    {"linha":2,"codigo":"TESTE-SRJ1","nome_completo":"Nome Atualizado","celular":"21900000999","placa":"tst9999","modal":"Carro","galpao":" srj 1 ","status":"ativo","inativo_desde":""},
    {"linha":3,"codigo":"TESTE-NOVO","nome_completo":"Motorista Novo Ficticio","celular":"21900000104","placa":"TST0004","modal":"Moto","galpao":"srj2","status":"inativo","inativo_desde":"05/09/2026"},
    {"linha":4,"codigo":"","nome_completo":"Sem codigo","galpao":"SRJ1","status":"ativo"},
    {"linha":5,"codigo":"TESTE-GALPAO-RUIM","galpao":"SRJ99","status":"ativo"},
    {"linha":6,"codigo":"TESTE-STATUS-RUIM","galpao":"SRJ1","status":"talvez"}
  ]';
begin
  select count(*) into n from public.motoristas where galpao is null;
  if n <> 1 then raise exception 'FALHOU: admin não vê motorista sem galpão'; end if;
  raise notice 'OK: admin vê motoristas sem galpão';

  select count(*) into n from public.user_roles;
  if n < 4 then raise exception 'FALHOU: admin não lê todos os user_roles'; end if;
  raise notice 'OK: admin lê todos os user_roles';

  r := public.importar_motoristas(csv);
  if (r ->> 'novos')::int <> 1 or (r ->> 'atualizados')::int <> 1 or jsonb_array_length(r -> 'erros') <> 3 then
    raise exception 'FALHOU: relatório da importação inesperado: %', r;
  end if;
  raise notice 'OK: importação retorna novos=1, atualizados=1, erros=3';

  -- TESTE-SRJ1 estava inativo (seção 2) e o CSV diz ativo: status NÃO muda.
  select count(*) into n from public.motoristas
   where codigo = 'TESTE-SRJ1' and status = 'inativo' and inativo_desde is not null
     and nome_completo = 'Nome Atualizado' and placa = 'TST9999' and galpao = 'SRJ1';
  if n <> 1 then raise exception 'FALHOU: importação sobrescreveu status ou não atualizou dados'; end if;
  raise notice 'OK: importação atualiza dados mas não sobrescreve status';

  select count(*) into n from public.motoristas
   where codigo = 'TESTE-NOVO' and status = 'inativo' and inativo_desde = date '2026-09-05' and galpao = 'SRJ2';
  if n <> 1 then raise exception 'FALHOU: motorista novo não entrou com status/galpão do CSV'; end if;
  raise notice 'OK: motorista novo entra com status do CSV e galpão normalizado';

  -- Reimportar o mesmo CSV: nada vira novo e status continua igual
  r := public.importar_motoristas(csv);
  if (r ->> 'novos')::int <> 0 or (r ->> 'atualizados')::int <> 2 then
    raise exception 'FALHOU: reimportação inesperada: %', r;
  end if;
  select count(*) into n from public.motoristas where codigo = 'TESTE-SRJ1' and status = 'inativo';
  if n <> 1 then raise exception 'FALHOU: reimportação sobrescreveu status'; end if;
  raise notice 'OK: reimportar o mesmo CSV não sobrescreve status';

  -- Exportação
  select count(*) into n from public.exportar_motoristas() e where e.codigo = 'TESTE-SRJ1' and e.atualizado_por_nome = 'Admin Teste';
  if n <> 1 then raise exception 'FALHOU: exportação sem autor da última alteração'; end if;
  raise notice 'OK: exportação traz autor da última alteração';

  -- Alertas: admin vê a inativação feita pelo dispatcher SRJ1
  select count(*) into n from public.motorista_historico h
   join public.perfis p on p.user_id = '00000000-0000-4000-a000-000000000001'
   where h.status_novo = 'inativo' and h.alterado_em > p.alertas_vistos_em;
  if n < 1 then raise exception 'FALHOU: admin não vê alerta de inativação'; end if;
  perform public.marcar_alertas_vistos();
  raise notice 'OK: alerta de inativação visível ao admin';
end;
$$;

reset role;

-- =====================================================================
-- 6. Dispatcher SRJ1 consegue reativar com histórico
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n integer;
begin
  perform public.alterar_status_motorista('10000000-0000-4000-a000-000000000001', 'ativo', null, 'voltou');
  select count(*) into n from public.motoristas
   where codigo = 'TESTE-SRJ1' and status = 'ativo' and inativo_desde is null and motivo_inativacao is null;
  if n <> 1 then raise exception 'FALHOU: reativação não aplicada'; end if;
  select count(*) into n from public.motorista_historico
   where motorista_id = '10000000-0000-4000-a000-000000000001' and status_novo = 'ativo';
  if n <> 1 then raise exception 'FALHOU: histórico da reativação não gravado'; end if;
  raise notice 'OK: reativação limpa inativo_desde e grava histórico';
end;
$$;

reset role;

-- =====================================================================
-- 7. Sincronização da planilha (aba INATIVOS)
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  begin
    perform public.sincronizar_inativos_planilha('[]'::jsonb);
    raise exception 'FALHOU: usuário logado (admin) chamou a sincronização direto';
  exception when insufficient_privilege then raise notice 'OK: sincronização não pode ser chamada pelo app (nem por admin)';
  end;
  begin
    perform 1 from public.planilha_inativacoes_processadas limit 1;
    raise exception 'FALHOU: usuário logado leu planilha_inativacoes_processadas';
  exception when insufficient_privilege then raise notice 'OK: controle da sincronização é inacessível ao app';
  end;
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
begin
  -- As Edge Functions de admin gravam perfil, papel e galpões como service_role.
  if not (has_table_privilege('service_role', 'public.perfis', 'INSERT')
      and has_table_privilege('service_role', 'public.perfis', 'UPDATE')
      and has_table_privilege('service_role', 'public.user_roles', 'INSERT')
      and has_table_privilege('service_role', 'public.dispatcher_galpoes', 'INSERT')) then
    raise exception 'FALHOU: service_role sem privilégios para as Edge Functions de admin';
  end if;
  raise notice 'OK: service_role pode criar e atualizar perfis, papéis e galpões';
end;
$$;

do $$
declare
  r      jsonb;
  linhas jsonb := '[
    {"linha":2,"nome_completo":"Motorista Ficticio Dois","placa":"tst-0002","celular":"","galpao":"SRJ2","data":"10/10/2026","motivo":"Saiu da operação","cpf":"00000000000"},
    {"linha":3,"nome_completo":"Sem Galpao","placa":"","celular":"(21) 90000-0103","galpao":"","data":"","motivo":"faltou muito"},
    {"linha":4,"nome_completo":"Nao Existe","placa":"ZZZ9Z99","celular":"21911112222","data":"01/10/2026"},
    {"linha":5,"nome_completo":"Sem Chave","placa":"","celular":""}
  ]';
begin
  r := public.sincronizar_inativos_planilha(linhas);
  if (r ->> 'inativados')::int <> 2 or (r ->> 'qtd_nao_encontrados')::int <> 1 or jsonb_array_length(r -> 'erros') <> 1 then
    raise exception 'FALHOU: resultado inesperado da sincronização: %', r;
  end if;
  raise notice 'OK: sincronização inativa por placa e por celular, aponta não encontrados e erros';

  if not exists (select 1 from public.motoristas where codigo = 'TESTE-SRJ2' and status = 'inativo'
                 and inativo_desde = date '2026-10-10' and motivo_inativacao = 'Saiu da operação') then
    raise exception 'FALHOU: motorista da planilha não foi inativado com data e motivo';
  end if;
  if not exists (select 1 from public.motoristas where codigo = 'TESTE-NULO' and status = 'inativo' and motivo_inativacao = 'Outro') then
    raise exception 'FALHOU: motivo livre da planilha não virou "Outro"';
  end if;
  if not exists (select 1 from public.motorista_historico h join public.motoristas m on m.id = h.motorista_id
                 where m.codigo = 'TESTE-NULO' and h.origem = 'planilha' and h.alterado_por is null
                   and h.alterado_por_nome = 'Planilha' and h.observacao = 'Inativado na planilha: faltou muito') then
    raise exception 'FALHOU: histórico da planilha incompleto';
  end if;
  raise notice 'OK: histórico registra origem planilha, motivo e observação';

  -- Reenviar a mesma aba não repete nada.
  r := public.sincronizar_inativos_planilha(linhas);
  if (r ->> 'inativados')::int <> 0 or (r ->> 'ja_processados')::int <> 2 then
    raise exception 'FALHOU: reenvio da planilha não foi idempotente: %', r;
  end if;
  raise notice 'OK: reenviar a mesma aba não duplica inativações';
end;
$$;

reset role;

-- Dispatcher SRJ2 vê o alerta da planilha e reativa; a planilha não re-inativa.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000003","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  if not exists (select 1 from public.motorista_historico where origem = 'planilha' and galpao = 'SRJ2') then
    raise exception 'FALHOU: dispatcher SRJ2 não vê a inativação vinda da planilha';
  end if;
  if exists (select 1 from public.motorista_historico h where h.origem = 'planilha' and h.galpao is null) then
    raise exception 'FALHOU: dispatcher SRJ2 viu inativação de motorista sem galpão';
  end if;
  raise notice 'OK: inativação da planilha aparece só para o galpão certo';
  perform public.alterar_status_motorista('10000000-0000-4000-a000-000000000002', 'ativo', null, 'voltou');
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
begin
  perform public.sincronizar_inativos_planilha('[{"linha":2,"placa":"TST0002","data":"10/10/2026","motivo":"Saiu da operação"}]'::jsonb);
  if not exists (select 1 from public.motoristas where codigo = 'TESTE-SRJ2' and status = 'ativo') then
    raise exception 'FALHOU: planilha re-inativou motorista reativado no app';
  end if;
  raise notice 'OK: motorista reativado no app não é re-inativado pela mesma linha da planilha';
end;
$$;

reset role;

-- =====================================================================
-- 8. Telefone dos usuários e novo admin
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n integer;
begin
  update public.perfis set telefone = '21988887777' where user_id = '00000000-0000-4000-a000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHOU: admin não conseguiu salvar telefone do dispatcher'; end if;
  raise notice 'OK: admin salva telefone do dispatcher';

  begin
    update public.perfis set telefone = '123' where user_id = '00000000-0000-4000-a000-000000000002';
    raise exception 'FALHOU: aceitou telefone inválido';
  exception when check_violation then raise notice 'OK: telefone inválido é recusado';
  end;

  -- Admin promove outro usuário a admin (mesmo caminho da Edge Function).
  insert into public.user_roles (user_id, role) values ('00000000-0000-4000-a000-000000000003', 'admin');
  raise notice 'OK: admin pode criar outro admin';
  -- Desfaz para os testes seguintes (SRJ2 volta a ser só dispatcher).
  delete from public.user_roles where user_id = '00000000-0000-4000-a000-000000000003' and role = 'admin';
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n integer;
begin
  update public.perfis set telefone = '21900000000' where user_id = '00000000-0000-4000-a000-000000000002';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: dispatcher alterou o próprio telefone direto'; end if;
  select count(*) into n from public.perfis where telefone is not null and user_id <> '00000000-0000-4000-a000-000000000002';
  if n <> 0 then raise exception 'FALHOU: dispatcher leu telefone de outro usuário'; end if;
  raise notice 'OK: dispatcher não altera telefone nem lê telefone de outros';
end;
$$;

reset role;

-- =====================================================================
-- 9. Aba ATIVOS da planilha e preenchimento de códigos
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  begin
    perform public.sincronizar_ativos_planilha('[]'::jsonb);
    raise exception 'FALHOU: usuário logado chamou sincronizar_ativos_planilha';
  exception when insufficient_privilege then raise notice 'OK: sincronização da aba ATIVOS não pode ser chamada pelo app';
  end;
  begin
    perform public.buscar_codigos_planilha('[]'::jsonb);
    raise exception 'FALHOU: usuário logado chamou buscar_codigos_planilha';
  exception when insufficient_privilege then raise notice 'OK: busca de códigos não pode ser chamada pelo app';
  end;
  begin
    perform public.importar_motoristas_nucleo('[]'::jsonb, null);
    raise exception 'FALHOU: usuário logado chamou o núcleo da importação';
  exception when insufficient_privilege then raise notice 'OK: núcleo da importação é interno';
  end;
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare r jsonb;
begin
  -- TESTE-NULO está inativo (seção 7): a aba ATIVOS atualiza dados mas não reativa.
  r := public.sincronizar_ativos_planilha('[
    {"linha":2,"codigo":"TESTE-NULO","nome_completo":"Nome Pela Planilha","celular":"21900000103","placa":"TST0003","galpao":" srj 4 ","modal":"Van"},
    {"linha":3,"codigo":"TESTE-PLAN","nome_completo":"Novo Pela Planilha","celular":"21900000555","placa":"TST0555","galpao":"HUB","modal":"Moto"},
    {"linha":4,"codigo":"","nome_completo":"Sem Codigo","placa":"TST0666"},
    {"linha":5,"codigo":"TESTE-RUIM","galpao":"XYZ"}
  ]'::jsonb);
  if (r ->> 'novos')::int <> 1 or (r ->> 'atualizados')::int <> 1 or jsonb_array_length(r -> 'erros') <> 2 then
    raise exception 'FALHOU: resultado inesperado da aba ATIVOS: %', r;
  end if;
  raise notice 'OK: aba ATIVOS cadastra novos, atualiza existentes e aponta erros';

  if not exists (select 1 from public.motoristas where codigo = 'TESTE-NULO' and status = 'inativo'
                 and nome_completo = 'Nome Pela Planilha' and galpao = 'SRJ4') then
    raise exception 'FALHOU: aba ATIVOS reativou motorista ou não atualizou os dados';
  end if;
  raise notice 'OK: aba ATIVOS não muda o status de quem já existe';

  if not exists (select 1 from public.motoristas where codigo = 'TESTE-PLAN' and status = 'ativo' and galpao = 'HUB') then
    raise exception 'FALHOU: motorista novo da planilha não entrou como ativo';
  end if;
  raise notice 'OK: motorista novo da aba ATIVOS entra como ativo';

  -- Preencher códigos: por placa, por celular, não encontrado.
  r := public.buscar_codigos_planilha('[
    {"linha":2,"placa":"tst-0555","celular":""},
    {"linha":3,"placa":"","celular":"(21) 90000-0103"},
    {"linha":4,"placa":"ZZZ9Z99","celular":""}
  ]'::jsonb);
  if r -> 0 ->> 'codigo' is distinct from 'TESTE-PLAN'
     or r -> 1 ->> 'codigo' is distinct from 'TESTE-NULO'
     or r -> 2 ->> 'situacao' is distinct from 'nao_encontrado' then
    raise exception 'FALHOU: busca de códigos inesperada: %', r;
  end if;
  raise notice 'OK: busca de códigos acha por placa e por celular';

  -- Aba INATIVOS com código: usa o código.
  r := public.sincronizar_inativos_planilha('[{"linha":9,"codigo":"TESTE-PLAN","data":"","motivo":"Documentação"}]'::jsonb);
  if (r ->> 'inativados')::int <> 1 or not exists (
       select 1 from public.motoristas where codigo = 'TESTE-PLAN' and status = 'inativo' and motivo_inativacao = 'Documentação') then
    raise exception 'FALHOU: inativação pela planilha usando código: %', r;
  end if;
  raise notice 'OK: aba INATIVOS localiza o motorista pelo código';
end;
$$;

reset role;

-- O CSV pelo app continua só para admin e com o mesmo comportamento.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform public.importar_motoristas('[{"codigo":"X","status":"ativo"}]'::jsonb);
    raise exception 'FALHOU: dispatcher importou depois da refatoração';
  exception when insufficient_privilege then raise notice 'OK: importação por CSV continua só para admin';
  end;
end;
$$;
reset role;

-- =====================================================================
-- 10. Aviso de movimentação (WhatsApp/planilha) via gatilho
-- Só roda no PGlite (npm run test:rls), onde pg_net é imitado; no projeto
-- real o SQL Editor pula esta parte para não disparar avisos de verdade.
-- =====================================================================
do $$
declare
  n_antes integer;
  n_depois integer;
begin
  if to_regclass('net._chamadas_teste') is null then
    raise notice 'OK: (pulado fora do PGlite) aviso de movimentação';
    return;
  end if;

  -- Sem segredos no Vault: nenhum aviso é disparado.
  select count(*) into n_antes from net._chamadas_teste;
  insert into public.motorista_historico (motorista_id, galpao, status_anterior, status_novo, motivo)
  values ('10000000-0000-4000-a000-000000000001', 'SRJ1', 'ativo', 'inativo', 'Outro');
  select count(*) into n_depois from net._chamadas_teste;
  if n_depois <> n_antes then raise exception 'FALHOU: aviso disparado sem segredos configurados'; end if;
  raise notice 'OK: sem segredos no Vault, nenhum aviso é disparado';

  insert into vault.decrypted_secrets values ('notificar_url', 'https://exemplo.test/aviso'), ('notificar_token', 'token-de-teste');

  -- Movimentação recente: dispara com o id do histórico e o token no cabeçalho.
  insert into public.motorista_historico (motorista_id, galpao, status_anterior, status_novo, motivo)
  values ('10000000-0000-4000-a000-000000000001', 'SRJ1', 'inativo', 'ativo', null);
  if not exists (select 1 from net._chamadas_teste
                 where url = 'https://exemplo.test/aviso' and headers ->> 'x-webhook-token' = 'token-de-teste'
                   and (body ->> 'historico_id')::bigint = (select max(id) from public.motorista_historico)) then
    raise exception 'FALHOU: movimentação recente não disparou aviso';
  end if;
  raise notice 'OK: movimentação recente dispara aviso com id e token';

  -- Inativação antiga (vinda da planilha com data passada): não avisa.
  select count(*) into n_antes from net._chamadas_teste;
  insert into public.motorista_historico (motorista_id, galpao, status_anterior, status_novo, motivo, alterado_em, origem)
  values ('10000000-0000-4000-a000-000000000001', 'SRJ1', 'ativo', 'inativo', 'Outro', now() - interval '3 days', 'planilha');
  select count(*) into n_depois from net._chamadas_teste;
  if n_depois <> n_antes then raise exception 'FALHOU: inativação antiga disparou aviso'; end if;
  raise notice 'OK: inativação antiga da planilha não dispara aviso';

  delete from vault.decrypted_secrets;
end;
$$;

do $$
begin
  set local role authenticated;
  begin
    perform 1 from public.movimentacoes_notificadas limit 1;
    raise exception 'FALHOU: usuário logado leu movimentacoes_notificadas';
  exception when insufficient_privilege then raise notice 'OK: controle de avisos é inacessível ao app';
  end;
  reset role;
end;
$$;

-- =====================================================================
-- 11. Solicitação: cancelar e fechamento automático pela planilha
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v_sol public.solicitacoes_inativacao;
begin
  v_sol := public.solicitar_inativacao('10000000-0000-4000-a000-000000000001', 'Documentação', null);
  perform public.cancelar_solicitacao_inativacao(v_sol.id);
  if not exists (select 1 from public.solicitacoes_inativacao where id = v_sol.id and status = 'cancelada') then
    raise exception 'FALHOU: dispatcher não cancelou a própria solicitação';
  end if;
  raise notice 'OK: dispatcher cancela a própria solicitação';

  perform public.solicitar_inativacao('10000000-0000-4000-a000-000000000001', 'Parou de rodar', null);
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
begin
  perform public.sincronizar_inativos_planilha('[{"linha":50,"placa":"TST9999","data":"","motivo":"Parou de rodar"}]'::jsonb);
  if exists (select 1 from public.solicitacoes_inativacao
             where motorista_id = '10000000-0000-4000-a000-000000000001' and status = 'pendente') then
    raise exception 'FALHOU: inativação pela planilha não fechou a solicitação pendente';
  end if;
  raise notice 'OK: inativação pela planilha fecha a solicitação pendente';
end;
$$;

reset role;

-- =====================================================================
-- 12. CPF e rotas (aba ATIVOS) e visibilidade por galpão
-- =====================================================================
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare r jsonb;
begin
  -- CPF sem o zero à esquerda (como a planilha costuma mandar) e rotas.
  r := public.sincronizar_ativos_planilha('[
    {"linha":2,"codigo":"TESTE-SRJ2","nome_completo":"Motorista Ficticio Dois","placa":"TST0002","galpao":"SRJ2",
     "cpf":"1234567890","realizou_rotas":"SIM","qtd_rotas":"42","ultima_rota":"15/10/2026"},
    {"linha":3,"codigo":"TESTE-PLAN","nome_completo":"Novo Pela Planilha","placa":"TST0555","galpao":"HUB",
     "cpf":"abc","realizou_rotas":"NÃO","qtd_rotas":"0","ultima_rota":""}
  ]'::jsonb);
  if jsonb_array_length(r -> 'erros') <> 0 then raise exception 'FALHOU: erros inesperados: %', r; end if;

  if not exists (select 1 from public.motoristas where codigo = 'TESTE-SRJ2' and cpf = '01234567890'
                 and realizou_rotas and qtd_rotas = 42 and ultima_rota = date '2026-10-15') then
    raise exception 'FALHOU: CPF/rotas não gravados corretamente';
  end if;
  if not exists (select 1 from public.motoristas where codigo = 'TESTE-PLAN' and cpf is null
                 and realizou_rotas = false and qtd_rotas = 0) then
    raise exception 'FALHOU: CPF inválido não virou nulo ou rotas erradas';
  end if;
  raise notice 'OK: aba ATIVOS grava CPF (completa zero à esquerda) e dados de rota';

  -- Linha sem os campos novos não apaga o que já existe.
  perform public.sincronizar_ativos_planilha('[{"linha":2,"codigo":"TESTE-SRJ2","nome_completo":"Motorista Ficticio Dois","placa":"TST0002","galpao":"SRJ2"}]'::jsonb);
  if not exists (select 1 from public.motoristas where codigo = 'TESTE-SRJ2' and cpf = '01234567890' and qtd_rotas = 42) then
    raise exception 'FALHOU: atualização sem CPF apagou o CPF existente';
  end if;
  raise notice 'OK: atualização sem CPF/rotas mantém os valores existentes';
end;
$$;

reset role;

-- Dispatcher: só CPF mascarado, e só do seu galpão. Admin: completo.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if exists (select 1 from public.motoristas where codigo = 'TESTE-SRJ2') then
    raise exception 'FALHOU: dispatcher SRJ1 viu motorista do SRJ2';
  end if;
  raise notice 'OK: dispatcher não vê CPF (nem mascarado) de outro galpão';
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000003","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if not exists (select 1 from public.motoristas where codigo = 'TESTE-SRJ2' and cpf_mascarado = '***.345.678-**') then
    raise exception 'FALHOU: dispatcher do galpão não vê o CPF mascarado';
  end if;
  raise notice 'OK: dispatcher vê o CPF mascarado dos motoristas do seu galpão';

  begin
    perform cpf from public.motoristas limit 1;
    raise exception 'FALHOU: dispatcher leu a coluna cpf completa';
  exception when insufficient_privilege then raise notice 'OK: dispatcher não consegue ler o CPF completo';
  end;

  begin
    perform public.cpf_completo('10000000-0000-4000-a000-000000000002');
    raise exception 'FALHOU: dispatcher obteve CPF completo pela função';
  exception when insufficient_privilege then raise notice 'OK: função de CPF completo é só para admin';
  end;
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  if public.cpf_completo('10000000-0000-4000-a000-000000000002') is distinct from '01234567890'
     or not exists (select 1 from public.cpfs_completos() c where c.cpf = '01234567890') then
    raise exception 'FALHOU: admin não obteve o CPF completo';
  end if;
  if not exists (select 1 from public.exportar_motoristas() e where e.cpf = '01234567890') then
    raise exception 'FALHOU: exportação do admin sem CPF completo';
  end if;
  raise notice 'OK: admin vê o CPF completo (tela e exportação)';
end;
$$;
reset role;

-- =====================================================================
-- 13. Placa repetida e motorista com duas placas
-- =====================================================================
insert into public.motoristas (codigo, nome_completo, celular, placa, galpao, status) values
  ('TESTE-AMB1', 'Joao Ambiguo',  '21911110001', 'AMB1C23',           'SRJ1', 'ativo'),
  ('TESTE-AMB2', 'Maria Ambígua', '21911110002', 'AMB1C23',           'SRJ1', 'ativo'),
  ('TESTE-DUAS', 'Duas Placas',   '21911110003', 'DUA1B11 / DUA2B22', 'SRJ1', 'ativo');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

do $$
declare r jsonb;
begin
  r := public.buscar_codigos_planilha('[
    {"linha":1,"placa":"AMB-1C23","celular":"","nome_completo":""},
    {"linha":2,"placa":"AMB1C23","celular":"(21) 91111-0002","nome_completo":""},
    {"linha":3,"placa":"AMB1C23","celular":"21999999999","nome_completo":"MARIA AMBIGUA"},
    {"linha":4,"placa":"DUA2B22","celular":"","nome_completo":""},
    {"linha":5,"placa":"XXX0X00 / DUA1B11","celular":"","nome_completo":""}
  ]'::jsonb);
  if r -> 0 ->> 'situacao' is distinct from 'ambiguo'
     or r -> 1 ->> 'codigo' is distinct from 'TESTE-AMB2'
     or r -> 2 ->> 'codigo' is distinct from 'TESTE-AMB2'
     or r -> 3 ->> 'codigo' is distinct from 'TESTE-DUAS'
     or r -> 4 ->> 'codigo' is distinct from 'TESTE-DUAS' then
    raise exception 'FALHOU: desempate de códigos inesperado: %', r;
  end if;
  raise notice 'OK: placa repetida desempata por celular e nome; reconhece duas placas';

  -- Aba INATIVOS: empate não inativa ninguém.
  r := public.sincronizar_inativos_planilha('[{"linha":7,"placa":"AMB1C23","celular":"","nome_completo":"","data":"","motivo":"Outro"}]'::jsonb);
  if jsonb_array_length(r -> 'ambiguos') <> 1 or (r ->> 'inativados')::int <> 0
     or exists (select 1 from public.motoristas where codigo in ('TESTE-AMB1', 'TESTE-AMB2') and status = 'inativo') then
    raise exception 'FALHOU: placa repetida sem desempate inativou alguém: %', r;
  end if;
  raise notice 'OK: placa repetida sem desempate não inativa ninguém (vai para "ambiguos")';

  -- Com o celular, inativa só o motorista certo.
  r := public.sincronizar_inativos_planilha('[{"linha":8,"placa":"AMB1C23","celular":"21911110001","nome_completo":"","data":"","motivo":"Outro"}]'::jsonb);
  if (r ->> 'inativados')::int <> 1
     or not exists (select 1 from public.motoristas where codigo = 'TESTE-AMB1' and status = 'inativo')
     or not exists (select 1 from public.motoristas where codigo = 'TESTE-AMB2' and status = 'ativo') then
    raise exception 'FALHOU: desempate por celular na aba INATIVOS: %', r;
  end if;
  raise notice 'OK: aba INATIVOS inativa só o motorista certo quando a placa é repetida';
end;
$$;

reset role;

do $$ begin raise notice '=== TODOS OS TESTES PASSARAM ==='; end $$;

rollback;
