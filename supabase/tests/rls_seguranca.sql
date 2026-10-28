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
-- 6. Dispatcher SRJ1 não reativa direto: pede, e o admin aprova
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  begin
    perform public.alterar_status_motorista('10000000-0000-4000-a000-000000000001', 'ativo', null, 'voltou');
    raise exception 'FALHOU: dispatcher reativou direto';
  exception when insufficient_privilege then raise notice 'OK: dispatcher não reativa direto';
  end;
  perform public.solicitar_reativacao_lote(array['10000000-0000-4000-a000-000000000001']::uuid[], 'Voltou a rodar', 'voltou');
  if (select status from public.motoristas where id = '10000000-0000-4000-a000-000000000001') <> 'inativo' then
    raise exception 'FALHOU: o pedido de reativação já reativou o motorista';
  end if;
  begin
    perform public.decidir_grupo_inativacao(
      (select grupo from public.solicitacoes_inativacao
        where motorista_id = '10000000-0000-4000-a000-000000000001' and status = 'pendente'), true, null);
    raise exception 'FALHOU: dispatcher aprovou a própria reativação';
  exception when insufficient_privilege then null;
  end;
  raise notice 'OK: dispatcher pede reativação e o motorista segue inativo até a aprovação';
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n integer; v_grupo uuid;
begin
  select grupo into v_grupo from public.solicitacoes_inativacao
   where motorista_id = '10000000-0000-4000-a000-000000000001' and status = 'pendente' and tipo = 'reativacao';
  if v_grupo is null then raise exception 'FALHOU: pedido de reativação não registrado'; end if;
  perform public.decidir_grupo_inativacao(v_grupo, true, null);
  if not exists (select 1 from public.solicitacoes_inativacao where grupo = v_grupo and status = 'aprovada') then
    raise exception 'FALHOU: pedido de reativação não ficou aprovado';
  end if;
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
  perform public.solicitar_reativacao_lote(array['10000000-0000-4000-a000-000000000002']::uuid[], 'Voltou a rodar', 'voltou');
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.decidir_grupo_inativacao(
    (select grupo from public.solicitacoes_inativacao
      where motorista_id = '10000000-0000-4000-a000-000000000002' and status = 'pendente' and tipo = 'reativacao'), true, null);
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

-- =====================================================================
-- 14. Notificações push: inscrições e aviso de pedido
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n integer;
begin
  perform public.registrar_push('https://fcm.googleapis.com/fcm/send/aparelho-1', 'chave-p256dh', 'chave-auth', 'teste');
  select count(*) into n from public.push_inscricoes;
  if n <> 1 then raise exception 'FALHOU: dispatcher não registrou a própria inscrição'; end if;
  raise notice 'OK: dispatcher registra notificação no próprio aparelho';

  begin
    perform public.registrar_push('http://inseguro.test/x', 'a', 'b', null);
    raise exception 'FALHOU: aceitou endpoint sem https';
  exception when invalid_parameter_value then raise notice 'OK: inscrição sem https é recusada';
  end;

  begin
    perform public.registrar_push('https://servidor-qualquer.example.com/x', 'a', 'b', null);
    raise exception 'FALHOU: aceitou endereço de push fora dos serviços oficiais (SSRF)';
  exception when invalid_parameter_value then raise notice 'OK: só serviços oficiais de push são aceitos (anti-SSRF)';
  end;

  begin
    insert into public.push_inscricoes (user_id, endpoint, p256dh, auth)
    values ('00000000-0000-4000-a000-000000000003', 'https://push.exemplo.test/x', 'a', 'b');
    raise exception 'FALHOU: gravou inscrição direto na tabela';
  exception when insufficient_privilege then raise notice 'OK: escrita direta em push_inscricoes é bloqueada';
  end;
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000003","role":"authenticated"}', true);
set local role authenticated;

do $$
declare n integer;
begin
  select count(*) into n from public.push_inscricoes;
  if n <> 0 then raise exception 'FALHOU: dispatcher viu inscrição de outro usuário'; end if;
  perform public.remover_push('https://fcm.googleapis.com/fcm/send/aparelho-1');
  raise notice 'OK: dispatcher não vê nem remove inscrição de outro usuário';

  -- Mesmo navegador usado por outra pessoa: passa a ser de quem entrou agora.
  perform public.registrar_push('https://fcm.googleapis.com/fcm/send/aparelho-1', 'chave-p256dh', 'chave-auth', 'teste');
  select count(*) into n from public.push_inscricoes where endpoint = 'https://fcm.googleapis.com/fcm/send/aparelho-1';
  if n <> 1 then raise exception 'FALHOU: aparelho compartilhado não trocou de dono'; end if;
  raise notice 'OK: aparelho compartilhado fica com quem entrou por último';
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
begin
  begin
    perform public.registrar_push('https://push.exemplo.test/anon', 'a', 'b', null);
    raise exception 'FALHOU: anon registrou notificação';
  exception when insufficient_privilege then raise notice 'OK: anon não registra notificação';
  end;
end;
$$;
reset role;

do $$
declare n_antes integer; n_depois integer;
begin
  if to_regclass('net._chamadas_teste') is null then
    raise notice 'OK: (pulado fora do PGlite) aviso de pedido';
    return;
  end if;
  insert into vault.decrypted_secrets values ('notificar_url', 'https://exemplo.test/aviso'), ('notificar_token', 'token-de-teste');

  select count(*) into n_antes from net._chamadas_teste;
  insert into public.solicitacoes_inativacao (motorista_id, galpao, motivo, solicitado_por, solicitado_por_nome)
  values ('10000000-0000-4000-a000-000000000002', 'SRJ2', 'Documentação', '00000000-0000-4000-a000-000000000003', 'Dispatcher SRJ2');
  if not exists (select 1 from net._chamadas_teste where body ->> 'status' = 'pendente' and body ? 'solicitacao_id') then
    raise exception 'FALHOU: novo pedido não disparou aviso';
  end if;
  update public.solicitacoes_inativacao set observacao = 'só texto' where status = 'pendente' and galpao = 'SRJ2';
  select count(*) into n_depois from net._chamadas_teste;
  if n_depois <> n_antes + 1 then raise exception 'FALHOU: alteração sem mudar status disparou aviso'; end if;
  update public.solicitacoes_inativacao set status = 'recusada' where status = 'pendente' and galpao = 'SRJ2';
  if not exists (select 1 from net._chamadas_teste where body ->> 'status' = 'recusada') then
    raise exception 'FALHOU: pedido recusado não disparou aviso';
  end if;
  raise notice 'OK: pedido novo e decidido disparam aviso (e só quando o status muda)';
  delete from vault.decrypted_secrets;
end;
$$;

-- =====================================================================
-- 15. Mesma pessoa com várias placas; pedidos e ações em lote
-- =====================================================================
insert into public.motoristas (id, codigo, nome_completo, celular, placa, galpao, status, cpf) values
  ('20000000-0000-4000-a000-000000000001', 'TESTE-P1A', 'Pessoa Duas Placas', '21922220001', 'PES1A11', 'SRJ1', 'ativo', '11122233344'),
  ('20000000-0000-4000-a000-000000000002', 'TESTE-P1B', 'Pessoa Duas Placas', '21922220001', 'PES1B22', 'SRJ1', 'ativo', '11122233344'),
  ('20000000-0000-4000-a000-000000000003', 'TESTE-FAM', 'Parente Mesmo Celular', '21922220001', 'FAM1C33', 'SRJ1', 'ativo', '99988877766'),
  ('20000000-0000-4000-a000-000000000004', 'TESTE-SEMCPF', 'Sem Cpf', '21922229999', 'SEM1D44', 'SRJ1', 'ativo', null),
  ('20000000-0000-4000-a000-000000000005', 'TESTE-SEMCPF2', 'Sem Cpf', '(21) 92222-9999', 'SEM1E55', 'SRJ1', 'ativo', null);

do $$
begin
  if (select count(distinct pessoa_id) from public.motoristas where codigo in ('TESTE-P1A', 'TESTE-P1B')) <> 1 then
    raise exception 'FALHOU: mesmo CPF não agrupou as placas';
  end if;
  if (select pessoa_id from public.motoristas where codigo = 'TESTE-FAM')
     = (select pessoa_id from public.motoristas where codigo = 'TESTE-P1A') then
    raise exception 'FALHOU: CPF diferente com mesmo celular foi agrupado';
  end if;
  if (select count(distinct pessoa_id) from public.motoristas where codigo in ('TESTE-SEMCPF', 'TESTE-SEMCPF2')) <> 1 then
    raise exception 'FALHOU: sem CPF, mesmo celular não agrupou';
  end if;
  raise notice 'OK: agrupa por CPF; sem CPF, por celular; CPF diferente não junta';
end;
$$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v_grupo uuid;
begin
  -- Dispatcher pede só UMA placa: a outra placa da mesma pessoa continua sem pedido.
  v_grupo := public.solicitar_inativacao_lote(array['20000000-0000-4000-a000-000000000001']::uuid[], 'Documentação', null);
  if exists (select 1 from public.solicitacoes_inativacao
             where motorista_id = '20000000-0000-4000-a000-000000000002' and status = 'pendente') then
    raise exception 'FALHOU: pedido de uma placa abriu pedido para a outra';
  end if;
  perform public.cancelar_grupo_inativacao(v_grupo);
  raise notice 'OK: dispatcher pede e cancela a inativação de só uma placa';

  -- Pedido do motorista inteiro (duas placas) num grupo só.
  v_grupo := public.solicitar_inativacao_lote(
    array['20000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002']::uuid[], 'Parou de rodar', null);
  if (select count(*) from public.solicitacoes_inativacao where grupo = v_grupo and status = 'pendente') <> 2 then
    raise exception 'FALHOU: pedido do motorista inteiro não criou as duas placas';
  end if;
  raise notice 'OK: pedido do motorista inteiro agrupa todas as placas';

  -- Lote com placa de outro galpão falha inteiro (nada é criado).
  begin
    perform public.solicitar_inativacao_lote(
      array['20000000-0000-4000-a000-000000000003', '10000000-0000-4000-a000-000000000002']::uuid[], 'Parou de rodar', null);
    raise exception 'FALHOU: lote com placa de outro galpão foi aceito';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.solicitacoes_inativacao
             where motorista_id = '20000000-0000-4000-a000-000000000003' and status = 'pendente') then
    raise exception 'FALHOU: lote rejeitado deixou pedido pela metade';
  end if;
  raise notice 'OK: lote com placa de outro galpão é recusado por inteiro';

  begin
    perform public.decidir_grupo_inativacao(v_grupo, true, null);
    raise exception 'FALHOU: dispatcher aprovou grupo';
  exception when insufficient_privilege then raise notice 'OK: dispatcher não aprova pedido em grupo';
  end;

  begin
    perform public.alterar_status_lote(array['20000000-0000-4000-a000-000000000004']::uuid[], 'inativo', 'Outro', 'x');
    raise exception 'FALHOU: dispatcher inativou direto em lote';
  exception when insufficient_privilege then raise notice 'OK: dispatcher não inativa direto em lote';
  end;
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare v_grupo uuid; n integer;
begin
  select grupo into v_grupo from public.solicitacoes_inativacao
  where motorista_id = '20000000-0000-4000-a000-000000000001' and status = 'pendente';
  n := public.decidir_grupo_inativacao(v_grupo, true, 'Enviado à Coopmetro');
  if n <> 2 or (select count(*) from public.motoristas where codigo in ('TESTE-P1A', 'TESTE-P1B') and status = 'inativo') <> 2 then
    raise exception 'FALHOU: aprovação em grupo não inativou as duas placas';
  end if;
  raise notice 'OK: admin aprova o pedido em grupo (todas as placas)';

  -- Admin inativa só uma placa direto e reativa em lote.
  perform public.alterar_status_lote(array['20000000-0000-4000-a000-000000000004']::uuid[], 'inativo', 'Documentação', null);
  if not exists (select 1 from public.motoristas where codigo = 'TESTE-SEMCPF' and status = 'inativo')
     or not exists (select 1 from public.motoristas where codigo = 'TESTE-SEMCPF2' and status = 'ativo') then
    raise exception 'FALHOU: inativar uma placa afetou a outra';
  end if;
  perform public.alterar_status_lote(
    array['20000000-0000-4000-a000-000000000001', '20000000-0000-4000-a000-000000000002']::uuid[], 'ativo', 'Voltou a rodar', null);
  if (select count(*) from public.motoristas where codigo in ('TESTE-P1A', 'TESTE-P1B') and status = 'ativo') <> 2 then
    raise exception 'FALHOU: reativação em lote';
  end if;
  raise notice 'OK: admin inativa só uma placa e reativa em lote';
end;
$$;

reset role;

-- =====================================================================
-- 16. Painel de atenção, relatório, último acesso e agendamentos
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;

do $$
begin
  if exists (select 1 from public.painel_atencao() p where p.galpao is distinct from 'SRJ1') then
    raise exception 'FALHOU: painel do dispatcher SRJ1 mostrou outro galpão';
  end if;
  if not exists (select 1 from public.painel_atencao() p where p.galpao = 'SRJ1' and p.ativos > 0) then
    raise exception 'FALHOU: painel do dispatcher sem o próprio galpão';
  end if;
  raise notice 'OK: painel de atenção mostra só os galpões do usuário';

  begin
    perform public.relatorio_mensal(current_date);
    raise exception 'FALHOU: dispatcher abriu o relatório mensal';
  exception when insufficient_privilege then raise notice 'OK: relatório mensal é só para admin';
  end;

  begin
    perform public.disparar_tarefa('lembrete_semanal');
    raise exception 'FALHOU: usuário disparou tarefa agendada';
  exception when insufficient_privilege then raise notice 'OK: tarefas agendadas não podem ser disparadas pelo app';
  end;

  perform public.registrar_acesso();
  if not exists (select 1 from public.perfis where user_id = '00000000-0000-4000-a000-000000000002' and ultimo_acesso is not null) then
    raise exception 'FALHOU: último acesso não registrado';
  end if;
  raise notice 'OK: último acesso é registrado';
end;
$$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;

do $$
declare r jsonb;
begin
  r := public.relatorio_mensal(current_date);
  if (r -> 'totais' ->> 'inativacoes')::int < 1 or jsonb_array_length(r -> 'por_motivo') < 1
     or jsonb_typeof(r -> 'por_galpao') <> 'array' or jsonb_typeof(r -> 'por_dispatcher') <> 'array' then
    raise exception 'FALHOU: relatório mensal incompleto: %', r;
  end if;
  raise notice 'OK: admin gera o relatório mensal';

  if (select count(*) from public.painel_atencao()) < 3 then
    raise exception 'FALHOU: painel do admin não mostra todos os galpões';
  end if;
  raise notice 'OK: painel do admin mostra todos os galpões';
end;
$$;

reset role;

do $$
begin
  if to_regclass('cron._jobs_teste') is null then
    raise notice 'OK: (pulado fora do PGlite) agendamentos';
    return;
  end if;
  if (select count(*) from cron._jobs_teste where nome in ('lembrete-semanal-dispatchers', 'aviso-pedidos-parados')) <> 2 then
    raise exception 'FALHOU: tarefas agendadas não foram criadas';
  end if;
  raise notice 'OK: lembrete semanal e aviso de pedido parado estão agendados';
end;
$$;

-- =====================================================================
-- 17. CPF e rotas pela aba INATIVOS (só completa dados)
-- =====================================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform public.atualizar_complemento_planilha('[]'::jsonb);
    raise exception 'FALHOU: usuário logado chamou atualizar_complemento_planilha';
  exception when insufficient_privilege then raise notice 'OK: complemento da planilha não pode ser chamado pelo app';
  end;
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
declare r jsonb; v_hist integer;
begin
  select count(*) into v_hist from public.motorista_historico;
  -- TESTE-AMB1 está inativo (seção 13).
  r := public.atualizar_complemento_planilha('[
    {"linha":2,"codigo":"TESTE-AMB1","cpf":"55566677788","realizou_rotas":"SIM","qtd_rotas":"7","ultima_rota":"01/08/2026"},
    {"linha":3,"codigo":"","placa":"AMB1C23","celular":"","nome_completo":"","cpf":"11111111111"},
    {"linha":4,"codigo":"NAO-EXISTE","cpf":"22222222222"},
    {"linha":5,"codigo":"TESTE-AMB2"}
  ]'::jsonb);
  if (r ->> 'atualizados')::int <> 1 or (r ->> 'ambiguos')::int <> 1 or (r ->> 'nao_encontrados')::int <> 1
     or (r ->> 'sem_dados')::int <> 1 then
    raise exception 'FALHOU: resultado inesperado do complemento: %', r;
  end if;
  if not exists (select 1 from public.motoristas where codigo = 'TESTE-AMB1' and status = 'inativo'
                 and cpf = '55566677788' and qtd_rotas = 7 and ultima_rota = date '2026-08-01') then
    raise exception 'FALHOU: complemento não gravou CPF/rotas ou mudou o status';
  end if;
  if (select count(*) from public.motorista_historico) <> v_hist then
    raise exception 'FALHOU: complemento gerou histórico';
  end if;
  raise notice 'OK: aba INATIVOS completa CPF e rotas sem mudar status nem gerar histórico';
end;
$$;
reset role;

-- =====================================================================
-- 18. Equipe: criar dispatcher (Edge Function), trocar função e excluir
-- =====================================================================
insert into auth.users (id, email) values
  ('00000000-0000-4000-a000-000000000018', 'novo.disp@exemplo.test'),
  ('00000000-0000-4000-a000-000000000019', 'outro.admin@exemplo.test');

-- A Edge Function admin-criar-usuario grava como service_role.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
do $$
begin
  insert into public.perfis (user_id, nome, email, telefone, ativo, trocar_senha)
    values ('00000000-0000-4000-a000-000000000018', 'Novo Disp', 'novo.disp@exemplo.test', '21999990018', true, true);
  insert into public.user_roles (user_id, role) values ('00000000-0000-4000-a000-000000000018', 'dispatcher');
  insert into public.dispatcher_galpoes (user_id, galpao) values
    ('00000000-0000-4000-a000-000000000018', 'SRJ1'), ('00000000-0000-4000-a000-000000000018', 'SRJ8');
  insert into public.perfis (user_id, nome, email, ativo, trocar_senha)
    values ('00000000-0000-4000-a000-000000000019', 'Outro Admin', 'outro.admin@exemplo.test', true, true);
  insert into public.user_roles (user_id, role) values ('00000000-0000-4000-a000-000000000019', 'admin');
  raise notice 'OK: service_role cria dispatcher com galpões';
end;
$$;
reset role;

-- Admin troca a função.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.mudar_papel_usuario('00000000-0000-4000-a000-000000000018', 'admin', null);
  if not exists (select 1 from public.user_roles where user_id = '00000000-0000-4000-a000-000000000018' and role = 'admin')
     or exists (select 1 from public.user_roles where user_id = '00000000-0000-4000-a000-000000000018' and role = 'dispatcher')
     or exists (select 1 from public.dispatcher_galpoes where user_id = '00000000-0000-4000-a000-000000000018') then
    raise exception 'FALHOU: dispatcher não virou admin (ou ficou com galpões)';
  end if;
  raise notice 'OK: admin promove dispatcher a admin';

  perform public.mudar_papel_usuario('00000000-0000-4000-a000-000000000018', 'dispatcher', array['SRJ2', 'srj9']);
  if not exists (select 1 from public.user_roles where user_id = '00000000-0000-4000-a000-000000000018' and role = 'dispatcher')
     or exists (select 1 from public.user_roles where user_id = '00000000-0000-4000-a000-000000000018' and role = 'admin')
     or (select array_agg(galpao order by galpao) from public.dispatcher_galpoes
         where user_id = '00000000-0000-4000-a000-000000000018') <> array['SRJ2', 'SRJ9'] then
    raise exception 'FALHOU: admin não virou dispatcher com os galpões escolhidos';
  end if;
  raise notice 'OK: admin rebaixa admin a dispatcher com galpões';

  begin
    perform public.mudar_papel_usuario('00000000-0000-4000-a000-000000000018', 'dispatcher', array[]::text[]);
    raise exception 'FALHOU: dispatcher ficou sem galpão';
  exception when check_violation then raise notice 'OK: dispatcher precisa de ao menos um galpão';
  end;
  begin
    perform public.mudar_papel_usuario('00000000-0000-4000-a000-000000000018', 'dispatcher', array['XYZ']);
    raise exception 'FALHOU: aceitou galpão inválido';
  exception when check_violation then raise notice 'OK: galpão inválido recusado';
  end;
  begin
    perform public.mudar_papel_usuario('00000000-0000-4000-a000-000000000001', 'dispatcher', array['SRJ1']);
    raise exception 'FALHOU: admin mudou a própria função';
  exception when insufficient_privilege then raise notice 'OK: admin não muda a própria função';
  end;
end;
$$;
reset role;

-- Dispatcher não troca função de ninguém.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform public.mudar_papel_usuario('00000000-0000-4000-a000-000000000002', 'admin', null);
    raise exception 'FALHOU: dispatcher se promoveu a admin';
  exception when insufficient_privilege then raise notice 'OK: dispatcher não troca função';
  end;
end;
$$;
reset role;

-- Excluir (Edge Function apaga o usuário no Auth): o resto cai junto, o histórico fica.
do $$
begin
  insert into public.motorista_historico (motorista_id, galpao, status_anterior, status_novo, motivo, alterado_por, alterado_por_nome, origem)
    values ('10000000-0000-4000-a000-000000000001', 'SRJ1', 'ativo', 'ativo', 'teste', '00000000-0000-4000-a000-000000000018', 'Novo Disp', 'app');
  delete from auth.users where id = '00000000-0000-4000-a000-000000000018';
  if exists (select 1 from public.perfis where user_id = '00000000-0000-4000-a000-000000000018')
     or exists (select 1 from public.user_roles where user_id = '00000000-0000-4000-a000-000000000018')
     or exists (select 1 from public.dispatcher_galpoes where user_id = '00000000-0000-4000-a000-000000000018') then
    raise exception 'FALHOU: excluir deixou perfil, função ou galpões para trás';
  end if;
  if not exists (select 1 from public.motorista_historico where alterado_por is null and alterado_por_nome = 'Novo Disp') then
    raise exception 'FALHOU: excluir apagou o histórico';
  end if;
  raise notice 'OK: excluir remove o usuário e mantém o histórico com o nome';
end;
$$;

-- =====================================================================
-- 19. Reativação com aprovação: recusa, pedido inválido e reativação direta do admin
-- =====================================================================
insert into public.motoristas (id, codigo, nome_completo, celular, placa, modal, galpao, status, inativo_desde, motivo_inativacao) values
  ('30000000-0000-4000-a000-000000000001', 'TESTE-REAT1', 'Reativar Um',   '21933330001', 'REA1A11', 'Moto', 'SRJ1', 'inativo', date '2026-10-01', 'Parou de rodar'),
  ('30000000-0000-4000-a000-000000000002', 'TESTE-REAT2', 'Reativar Dois', '21933330002', 'REA1B22', 'Moto', 'SRJ1', 'inativo', date '2026-10-01', 'Parou de rodar'),
  ('30000000-0000-4000-a000-000000000003', 'TESTE-REAT3', 'Ativo Tres',    '21933330003', 'REA1C33', 'Moto', 'SRJ1', 'ativo', null, null);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.solicitar_reativacao_lote(array['30000000-0000-4000-a000-000000000001']::uuid[], 'Documentação regularizada', null);
  perform public.solicitar_reativacao_lote(array['30000000-0000-4000-a000-000000000002']::uuid[], 'Voltou a rodar', 'voltou a rodar');
  begin
    perform public.solicitar_reativacao_lote(array['30000000-0000-4000-a000-000000000003']::uuid[], 'Voltou a rodar', null);
    raise exception 'FALHOU: pediu reativação de motorista ativo';
  exception when invalid_parameter_value then raise notice 'OK: não pede reativação de quem já está ativo';
  end;
  begin
    perform public.solicitar_reativacao_lote(array['30000000-0000-4000-a000-000000000001']::uuid[], 'Voltou a rodar', null);
    raise exception 'FALHOU: dois pedidos pendentes para o mesmo motorista';
  exception when invalid_parameter_value then raise notice 'OK: um pedido pendente por motorista';
  end;
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.decidir_grupo_inativacao(
    (select grupo from public.solicitacoes_inativacao where motorista_id = '30000000-0000-4000-a000-000000000001' and status = 'pendente'),
    false, 'ainda sem documentação');
  if not exists (select 1 from public.motoristas where id = '30000000-0000-4000-a000-000000000001'
                 and status = 'inativo' and motivo_inativacao = 'Parou de rodar') then
    raise exception 'FALHOU: recusar a reativação mudou o motorista';
  end if;
  raise notice 'OK: reativação recusada mantém o motorista inativo';

  perform public.alterar_status_motorista('30000000-0000-4000-a000-000000000002', 'ativo', 'Voltou a rodar', null);
  if not exists (select 1 from public.solicitacoes_inativacao where motorista_id = '30000000-0000-4000-a000-000000000002'
                 and tipo = 'reativacao' and status = 'aprovada') then
    raise exception 'FALHOU: reativação direta do admin não fechou o pedido pendente';
  end if;
  raise notice 'OK: admin reativa direto e o pedido pendente fica aprovado';
end;
$$;
reset role;

-- =====================================================================
-- 20. Motivo da reativação e alertas lidos um a um
-- =====================================================================
insert into public.motoristas (id, codigo, nome_completo, celular, placa, modal, galpao, status, inativo_desde, motivo_inativacao,
                               realizou_rotas, qtd_rotas, ultima_rota) values
  ('40000000-0000-4000-a000-000000000001', 'TESTE-MOT1', 'Motivo Um', '21944440001', 'MOT1A11', 'Moto', 'SRJ1', 'inativo',
   date '2026-10-01', 'Parou de rodar', null, null, null),
  ('40000000-0000-4000-a000-000000000002', 'TESTE-CORTE', 'Para Cortar', '21944440002', 'COR1A11', 'Moto', 'SRJ1', 'ativo',
   null, null, true, 9, (now() at time zone 'America/Sao_Paulo')::date - 25),
  ('40000000-0000-4000-a000-000000000003', 'TESTE-CORTE2', 'Corte Outro Galpao', '21944440003', 'COR1B22', 'Moto', 'SRJ2', 'ativo',
   null, null, true, 9, (now() at time zone 'America/Sao_Paulo')::date - 40),
  ('40000000-0000-4000-a000-000000000004', 'TESTE-RODANDO', 'Rodando', '21944440004', 'ROD1A11', 'Moto', 'SRJ1', 'ativo',
   null, null, true, 9, (now() at time zone 'America/Sao_Paulo')::date - 3);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare n integer; n2 integer; v_chave text;
begin
  begin
    perform public.solicitar_reativacao_lote(array['40000000-0000-4000-a000-000000000001']::uuid[], null, null);
    raise exception 'FALHOU: pediu reativação sem motivo';
  exception when invalid_parameter_value then raise notice 'OK: reativação exige motivo';
  end;
  begin
    perform public.solicitar_reativacao_lote(array['40000000-0000-4000-a000-000000000001']::uuid[], 'Outro', null);
    raise exception 'FALHOU: motivo Outro sem observação';
  exception when invalid_parameter_value then raise notice 'OK: motivo Outro exige observação';
  end;
  perform public.solicitar_reativacao_lote(array['40000000-0000-4000-a000-000000000001']::uuid[], 'Documentação regularizada', 'CNH renovada');
  if not exists (select 1 from public.solicitacoes_inativacao where motorista_id = '40000000-0000-4000-a000-000000000001'
                 and tipo = 'reativacao' and motivo = 'Documentação regularizada' and observacao = 'CNH renovada') then
    raise exception 'FALHOU: motivo da reativação não foi guardado no pedido';
  end if;
  raise notice 'OK: motivo e observação da reativação ficam guardados no pedido';

  -- Alertas: o dispatcher SRJ1 vê só o "para cortar" do galpão dele (20+ dias), não o de 3 dias.
  n := public.alertas_nao_lidos();
  v_chave := 'rota:40000000-0000-4000-a000-000000000002:' || ((now() at time zone 'America/Sao_Paulo')::date - 25);
  perform public.marcar_alertas_lidos(array[v_chave, 'rota:40000000-0000-4000-a000-000000000004:x', 'invalida; drop']);
  n2 := public.alertas_nao_lidos();
  if n2 <> n - 1 then raise exception 'FALHOU: marcar como lido não baixou a contagem (% → %)', n, n2; end if;
  if (select count(*) from public.alertas_lidos) <> (select count(*) from public.alertas_lidos where user_id = '00000000-0000-4000-a000-000000000002') then
    raise exception 'FALHOU: dispatcher leu alertas lidos de outra pessoa';
  end if;
  if exists (select 1 from public.alertas_lidos where chave = 'invalida; drop') then
    raise exception 'FALHOU: aceitou chave de alerta inválida';
  end if;
  raise notice 'OK: alerta de corte (20+ dias) conta como não lido até marcar, e cada um vê só os seus';
  begin
    insert into public.alertas_lidos (user_id, chave) values ('00000000-0000-4000-a000-000000000003', 'mov:1');
    raise exception 'FALHOU: gravou alerta lido direto na tabela';
  exception when insufficient_privilege then raise notice 'OK: alertas lidos só pela função';
  end;
end;
$$;
reset role;

-- Admin aprova: a reativação grava o motivo no histórico e o pedido vira alerta não lido de quem pediu.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    perform public.alterar_status_motorista('40000000-0000-4000-a000-000000000001', 'ativo', null, null);
    raise exception 'FALHOU: admin reativou sem motivo';
  exception when invalid_parameter_value then raise notice 'OK: reativação direta do admin também exige motivo';
  end;
  perform public.decidir_grupo_inativacao(
    (select grupo from public.solicitacoes_inativacao where motorista_id = '40000000-0000-4000-a000-000000000001' and status = 'pendente'),
    true, null);
  if not exists (select 1 from public.motorista_historico where motorista_id = '40000000-0000-4000-a000-000000000001'
                 and status_novo = 'ativo' and motivo = 'Documentação regularizada') then
    raise exception 'FALHOU: motivo da reativação não foi para o histórico';
  end if;
  raise notice 'OK: motivo da reativação fica no histórico do motorista';
end;
$$;
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000002","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_grupo text; n integer;
begin
  select coalesce(grupo::text, id::text) into v_grupo from public.solicitacoes_inativacao
   where motorista_id = '40000000-0000-4000-a000-000000000001' and status = 'aprovada';
  n := public.alertas_nao_lidos();
  perform public.marcar_alertas_lidos(array['pedido:' || v_grupo]);
  if public.alertas_nao_lidos() <> n - 1 then raise exception 'FALHOU: pedido aprovado não era alerta não lido'; end if;
  raise notice 'OK: pedido aprovado aparece como alerta não lido para quem pediu';
end;
$$;
reset role;

-- BASE - SUPABASE (CRM): só service_role sincroniza; o CRM manda no status só quando ele muda.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-a000-000000000001","role":"authenticated"}', true);
set local role authenticated;
do $$
begin
  perform public.sincronizar_base_crm('[]'::jsonb);
  raise exception 'FALHOU: usuário logado executou sincronizar_base_crm';
exception when insufficient_privilege then raise notice 'OK: só a Edge Function sincroniza a base do CRM';
end;
$$;
reset role;

set local role service_role;
do $$
declare r jsonb; v_m public.motoristas;
begin
  r := public.sincronizar_base_crm('[
    {"linha":2,"crm_id":"70000000-0000-4000-a000-000000000001","status":"ativo","nome_completo":"Teste Crm Um",
     "cpf":"1234567890","celular":"(21) 90000-0001","galpao":"SRJ1","modal":"passeio","placa":"tst-1a11",
     "id_coopmetro":"99001","qtd_rotas":"12","ultima_rota":"2026-10-20"},
    {"linha":3,"crm_id":"70000000-0000-4000-a000-000000000002","status":"pausado","nome_completo":"Teste Crm Dois",
     "galpao":"SRJ2","atualizado_crm":"2026-09-01T12:00:00+00:00"},
    {"linha":4,"crm_id":"70000000-0000-4000-a000-000000000003","status":"cancelado","nome_completo":"Teste Crm Tres"},
    {"linha":5,"crm_id":"nao-e-uuid","status":"ativo"}
  ]'::jsonb);
  if (r ->> 'novos')::int <> 2 or (r ->> 'ignorados')::int <> 1 or jsonb_array_length(r -> 'erros') <> 1 then
    raise exception 'FALHOU: resultado inesperado da base do CRM: %', r;
  end if;
  select * into v_m from public.motoristas where crm_id = '70000000-0000-4000-a000-000000000001';
  if v_m.codigo <> '99001' or v_m.status <> 'ativo' or v_m.cpf <> '01234567890' or v_m.placa <> 'TST1A11'
     or v_m.qtd_rotas <> 12 or not v_m.realizou_rotas or v_m.nome_completo <> 'TESTE CRM UM' then
    raise exception 'FALHOU: cadastro do CRM gravado errado';
  end if;
  select * into v_m from public.motoristas where crm_id = '70000000-0000-4000-a000-000000000002';
  if v_m.status <> 'inativo' or v_m.codigo not like 'CRM-%' or v_m.inativo_desde <> '2026-09-01' then
    raise exception 'FALHOU: pausado do CRM deveria entrar inativo com código provisório';
  end if;
  raise notice 'OK: base do CRM cadastra ativo e pausado, ignora cancelado e rejeita id inválido';
end;
$$;
reset role;

-- App inativa o motorista 1; o CRM continua "ativo" → a sincronização não desfaz.
update public.motoristas set status = 'inativo' where crm_id = '70000000-0000-4000-a000-000000000001';
set local role service_role;
do $$
begin
  perform public.sincronizar_base_crm('[{"crm_id":"70000000-0000-4000-a000-000000000001","status":"ativo"}]'::jsonb);
  if (select status from public.motoristas where crm_id = '70000000-0000-4000-a000-000000000001') <> 'inativo' then
    raise exception 'FALHOU: sincronização desfez a inativação feita no app';
  end if;
  raise notice 'OK: status do CRM sem mudança não desfaz o que foi feito no app';
end;
$$;
reset role;

-- CRM passa a "inativo" e depois volta a "ativo": o app acompanha e grava histórico.
update public.motoristas set status = 'ativo' where crm_id = '70000000-0000-4000-a000-000000000001';
set local role service_role;
do $$
declare r jsonb;
begin
  r := public.sincronizar_base_crm('[{"crm_id":"70000000-0000-4000-a000-000000000001","status":"inativo","encerramento_motivo":"desistiu"}]'::jsonb);
  if (r ->> 'inativados')::int <> 1 or not exists (
       select 1 from public.motorista_historico h join public.motoristas m on m.id = h.motorista_id
        where m.crm_id = '70000000-0000-4000-a000-000000000001' and h.status_novo = 'inativo'
          and h.origem = 'planilha' and h.observacao like 'Inativado no CRM%desistiu') then
    raise exception 'FALHOU: inativação no CRM não chegou ao app: %', r;
  end if;
  r := public.sincronizar_base_crm('[{"crm_id":"70000000-0000-4000-a000-000000000001","status":"ativo","id_coopmetro":"99001"}]'::jsonb);
  if (r ->> 'reativados')::int <> 1
     or (select status from public.motoristas where crm_id = '70000000-0000-4000-a000-000000000001') <> 'ativo' then
    raise exception 'FALHOU: reativação no CRM não chegou ao app: %', r;
  end if;
  raise notice 'OK: inativação e reativação no CRM chegam ao app com histórico';
end;
$$;
reset role;

do $$ begin raise notice '=== TODOS OS TESTES PASSARAM ==='; end $$;

rollback;
