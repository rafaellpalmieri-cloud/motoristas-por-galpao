-- Todo dia às 16:00 (Brasília = 19:00 UTC): push para os dispatchers do galpão
-- que tem treinamento já passado sem presença marcada (função notificar-movimentacao,
-- tarefa "presencas_pendentes").
select cron.schedule('aviso-presencas-pendentes', '0 19 * * *', $$select public.disparar_tarefa('presencas_pendentes')$$);
