-- =====================================================================
-- Dados FICTÍCIOS para desenvolvimento local (supabase db reset).
-- Nomes, celulares e placas são inventados. Não colocar dados reais aqui.
-- =====================================================================
insert into public.motoristas (codigo, nome_completo, celular, placa, modal, galpao, status, inativo_desde)
values
  ('FAKE-0001', 'Ana Teste Silva',      '21900000001', 'TST1A01', 'Moto',  'SRJ1',  'ativo',   null),
  ('FAKE-0002', 'Bruno Exemplo Souza',  '21900000002', 'TST1A02', 'Carro', 'SRJ1',  'ativo',   null),
  ('FAKE-0003', 'Carla Ficticia Lima',  '21900000003', 'TST1A03', 'Van',   'SRJ1',  'inativo', '2026-09-01'),
  ('FAKE-0004', 'Diego Demo Rocha',     '21900000004', 'TST2B04', 'Moto',  'SRJ2',  'ativo',   null),
  ('FAKE-0005', 'Elisa Modelo Costa',   '21900000005', 'TST2B05', 'Carro', 'SRJ2',  'ativo',   null),
  ('FAKE-0006', 'Fabio Amostra Dias',   '21900000006', 'TST4C06', 'Moto',  'SRJ4',  'ativo',   null),
  ('FAKE-0007', 'Gabi Prova Martins',   '21900000007', 'TST9D07', 'Van',   'HUB',   'ativo',   null),
  ('FAKE-0008', 'Hugo Semgalpao Alves', '21900000008', 'TST0E08', 'Moto',  null,    'ativo',   null)
on conflict (codigo) do nothing;
