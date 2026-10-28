-- =====================================================================
-- Recomeço do zero (pedido do usuário em 28/10/2026)
-- Apaga só os dados de motoristas e o que deriva deles. A planilha
-- "RELAÇÃO INTERNA ATIVOS E INATIVOS" continua sendo a origem e volta a
-- preencher o app na próxima sincronização.
-- Mantém estrutura, regras de segurança, equipe (perfis, papéis, galpões)
-- e as inscrições de notificação push.
-- Num banco novo (sem dados) não faz nada.
-- =====================================================================

truncate table
  public.solicitacoes_notificadas,
  public.movimentacoes_notificadas,
  public.planilha_inativacoes_processadas,
  public.solicitacoes_inativacao,
  public.motorista_historico,
  public.motoristas,
  public.alertas_lidos
restart identity;
