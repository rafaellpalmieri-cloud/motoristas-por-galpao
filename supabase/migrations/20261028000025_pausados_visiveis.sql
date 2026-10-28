-- =====================================================================
-- Aba "Pausados" (decisão de 28/10/2026): o app separa os pausados do CRM
-- dos inativos e, entre eles, quem já operou (ID Coopmetro ou rotas).
-- Para isso o usuário logado passa a ler crm_status e id_coopmetro.
-- (crm_id continua só no banco.)
-- =====================================================================

grant select (crm_status, id_coopmetro) on public.motoristas to authenticated;
