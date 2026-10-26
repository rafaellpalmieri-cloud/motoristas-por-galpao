-- Limites de tamanho em campos gravados pelo app (evita textos gigantes).
alter table public.alertas_lidos
  add constraint alertas_lidos_chave_tamanho check (length(chave) <= 200);
alter table public.push_inscricoes
  add constraint push_p256dh_tamanho check (length(p256dh) <= 200),
  add constraint push_auth_tamanho check (length(auth) <= 100),
  add constraint push_user_agent_tamanho check (user_agent is null or length(user_agent) <= 300);
