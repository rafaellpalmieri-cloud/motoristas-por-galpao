/**
 * LoogiRio Frota — sincroniza a planilha interna com o app.
 *
 * Cole este arquivo em: Planilha → Extensões → Apps Script (substituindo tudo).
 * Passo a passo completo: docs/PLANILHA_SHEETS.md
 *
 * Origem dos motoristas: aba "BASE - SUPABASE" (exportação do CRM, sem fórmulas).
 * Cada cadastro é identificado pelo "id" do CRM. As rotas vêm da aba
 * "BASE - POWER BI", somadas por CPF. As abas ATIVOS e INATIVOS não são mais usadas.
 *
 * Funções para executar:
 *  - sincronizarTudo     → envia a BASE - SUPABASE (com as rotas) ao app: cadastra,
 *                           atualiza dados e segue as mudanças de status do CRM.
 *  - instalarGatilho     → UMA vez: agenda sincronizarTudo a cada 15 minutos e o
 *                           backup semanal (domingo de madrugada).
 *  - pausarSincronizacao → desliga a sincronização automática.
 *  - fazerBackup         → salva no seu Google Drive uma cópia (CSV) de motoristas,
 *                           histórico, pedidos e equipe. Mantém os 12 últimos.
 *  - doPost              → recebe do app as movimentações (aba "MOVIMENTAÇÕES APP");
 *                           só funciona depois de Implantar → App da Web.
 *
 * Segurança:
 *  - Só as colunas das listas COLUNAS_BASE e COLUNAS_ROTAS saem da planilha.
 *    RG, endereço, filiação, veículo (renavam/chassi) etc. NUNCA são lidos.
 *  - O token fica nas Propriedades do script (não neste código).
 */

const CONFIG = {
  ABA_BASE: 'BASE - SUPABASE',
  ABA_ROTAS: 'BASE - POWER BI',
  URL_FUNCAO: 'https://idihrzbchxaptjgvsjfu.supabase.co/functions/v1/sincronizar-planilha',
  TAMANHO_LOTE: 200,
  PASTA_BACKUP: 'Backups - Motoristas por Galpão',
  BACKUPS_MANTIDOS: 12,
  INTERVALO_MINUTOS: 15,
};

// Campo enviado ao app → nome da coluna na aba BASE - SUPABASE.
const COLUNAS_BASE = {
  crm_id: 'id',
  status: 'status',
  nome_completo: 'nome_completo',
  cpf: 'cpf',
  celular: 'celular',
  galpao: 'galpao',
  modal: 'tipo_veiculo',
  placa: 'placa',
  id_coopmetro: 'id_coopmetro',
  encerramento_motivo: 'encerramento_motivo',
  atualizado_crm: 'updated_at',
};

// Colunas da aba BASE - POWER BI (comparadas sem acento, minúsculas).
const COLUNAS_ROTAS = {
  cpf: 'cpf_motorista_logistcs',
  rotas_meli: 'rotas_meli',
  ultima_meli: 'ultima_rota_meli',
  rotas_shopee: 'rotas_shopee',
  ultima_shopee: 'ultima_rota_shopee',
};

// Colunas que jamais podem ser lidas ou enviadas.
const PROIBIDAS = /^rg$|_rg$|^rg_|endereco|logradouro|cep|bairro|nome_mae|nome_pai|renavan|chassi/;

const FUSO = 'America/Sao_Paulo';

function normalizar_(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function token_() {
  const t = PropertiesService.getScriptProperties().getProperty('PLANILHA_SYNC_TOKEN');
  if (!t) throw new Error('Defina PLANILHA_SYNC_TOKEN em Configurações do projeto → Propriedades do script.');
  return t;
}

function aba_(nome) {
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  if (!aba) throw new Error('Aba "' + nome + '" não encontrada.');
  return aba;
}

/** Lê SÓ as colunas pedidas (coluna a coluna, nunca a linha inteira). Devolve { campo: [valores] }. */
function lerColunas_(aba, colunas) {
  const total = aba.getLastRow() - 1;
  const cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(normalizar_);
  const valores = {};
  Object.keys(colunas).forEach(function (campo) {
    const nome = colunas[campo];
    const i = cabecalho.indexOf(nome);
    if (i < 0 || PROIBIDAS.test(nome)) throw new Error('Aba "' + aba.getName() + '" sem a coluna "' + nome + '".');
    valores[campo] = total < 1 ? [] : aba.getRange(2, i + 1, total, 1).getValues().map(function (r) { return r[0]; });
  });
  return { total: Math.max(total, 0), valores: valores };
}

function texto_(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Utilities.formatDate(v, FUSO, "yyyy-MM-dd'T'HH:mm:ssXXX");
  return String(v).trim();
}

/** Data (Date, "dd/mm/aaaa" ou "aaaa-mm-dd") → "aaaa-mm-dd"; inválida → ''. */
function dataIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, FUSO, 'yyyy-MM-dd');
  const s = String(v || '').trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

function cpf_(v) {
  const d = String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
  return d.length >= 9 && d.length <= 11 ? ('00' + d).slice(-11) : '';
}

/** BASE - POWER BI → { cpf: { qtd, ultima } } (maior contagem Meli + Shopee e data mais recente). */
function rotasPorCpf_() {
  const lido = lerColunas_(aba_(CONFIG.ABA_ROTAS), COLUNAS_ROTAS);
  const v = lido.valores;
  const meli = {};
  const shopee = {};
  const ultima = {};
  for (let r = 0; r < lido.total; r++) {
    const cpf = cpf_(v.cpf[r]);
    if (!cpf) continue;
    meli[cpf] = Math.max(meli[cpf] || 0, Number(v.rotas_meli[r]) || 0);
    shopee[cpf] = Math.max(shopee[cpf] || 0, Number(v.rotas_shopee[r]) || 0);
    [dataIso_(v.ultima_meli[r]), dataIso_(v.ultima_shopee[r])].forEach(function (d) {
      if (d && (!ultima[cpf] || d > ultima[cpf])) ultima[cpf] = d;
    });
  }
  const saida = {};
  Object.keys(meli).forEach(function (cpf) {
    saida[cpf] = { qtd: meli[cpf] + shopee[cpf], ultima: ultima[cpf] || '' };
  });
  return saida;
}

/** Envia em lotes; devolve a lista de respostas. */
function enviar_(acao, linhas) {
  const token = token_();
  const respostas = [];
  for (let i = 0; i < linhas.length; i += CONFIG.TAMANHO_LOTE) {
    const resposta = UrlFetchApp.fetch(CONFIG.URL_FUNCAO, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-sync-token': token },
      payload: JSON.stringify({ acao: acao, linhas: linhas.slice(i, i + CONFIG.TAMANHO_LOTE) }),
      muteHttpExceptions: true,
    });
    const codigo = resposta.getResponseCode();
    if (codigo !== 200) throw new Error('Falha ao enviar ' + acao + ' (' + codigo + '): ' + resposta.getContentText());
    respostas.push(JSON.parse(resposta.getContentText()));
  }
  return respostas;
}

/** BASE - SUPABASE (+ rotas) → app. */
function sincronizarBase() {
  const lido = lerColunas_(aba_(CONFIG.ABA_BASE), COLUNAS_BASE);
  const rotas = rotasPorCpf_();
  const v = lido.valores;
  const linhas = [];
  for (let r = 0; r < lido.total; r++) {
    const crmId = texto_(v.crm_id[r]);
    if (!crmId) continue;
    const item = { linha: r + 2 };
    Object.keys(COLUNAS_BASE).forEach(function (campo) { item[campo] = texto_(v[campo][r]); });
    item.cpf = cpf_(v.cpf[r]);
    const rota = item.cpf ? rotas[item.cpf] : null;
    if (rota) {
      item.qtd_rotas = String(rota.qtd);
      item.ultima_rota = rota.ultima;
    }
    linhas.push(item);
  }

  const total = { enviados: linhas.length, novos: 0, atualizados: 0, inativados: 0, reativados: 0, ignorados: 0, erros: 0 };
  const exemplosErro = [];
  enviar_('base', linhas).forEach(function (r) {
    ['novos', 'atualizados', 'inativados', 'reativados', 'ignorados'].forEach(function (k) { total[k] += r[k] || 0; });
    total.erros += (r.erros || []).length;
    (r.erros || []).slice(0, 10 - exemplosErro.length).forEach(function (e) { exemplosErro.push('linha ' + e.linha + ': ' + e.erro); });
  });
  console.log('BASE - SUPABASE: ' + JSON.stringify(total) +
    ' (ignorados = cadastros que não são ativo, inativo nem pausado)' +
    (exemplosErro.length ? '\n  ' + exemplosErro.join('\n  ') : ''));
}

/** Executado pelo gatilho. */
function sincronizarTudo() {
  sincronizarBase();
}

/** Desliga a sincronização automática (o backup semanal continua). Para religar: instalarGatilho. */
function pausarSincronizacao() {
  let n = 0;
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sincronizarTudo' || t.getHandlerFunction() === 'sincronizarInativos'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); n++; });
  console.log('Sincronização automática pausada (' + n + ' gatilho(s) removido(s)). Para religar, rode instalarGatilho.');
}

// ---------------------------------------------------------------------
// App → planilha: cada inativação/reativação feita NO APP vira uma linha
// na aba "MOVIMENTAÇÕES APP". Exige implantar este script como App da Web
// (Implantar → Nova implantação → App da Web). Ver docs/PLANILHA_SHEETS.md.
// ---------------------------------------------------------------------
const ABA_MOVIMENTACOES = 'MOVIMENTAÇÕES APP';
const CABECALHO_MOVIMENTACOES = ['Data', 'Código', 'Nome', 'Placa', 'Galpão', 'De', 'Para', 'Motivo', 'Observação', 'Por'];

/** Evita que um texto vindo do app seja interpretado como fórmula. */
function textoSeguro_(v) {
  const s = String(v === null || v === undefined ? '' : v).slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function resposta_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const dados = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const esperado = PropertiesService.getScriptProperties().getProperty('PLANILHA_SYNC_TOKEN');
    if (!esperado || dados.token !== esperado) return resposta_({ ok: false, erro: 'não autorizado' });

    const m = dados.movimento || {};
    const planilha = SpreadsheetApp.getActiveSpreadsheet();
    const trava = LockService.getScriptLock();
    trava.waitLock(10000);
    try {
      let aba = planilha.getSheetByName(ABA_MOVIMENTACOES);
      if (!aba) {
        aba = planilha.insertSheet(ABA_MOVIMENTACOES);
        aba.appendRow(CABECALHO_MOVIMENTACOES);
        aba.setFrozenRows(1);
        aba.getRange(1, 1, 1, CABECALHO_MOVIMENTACOES.length).setFontWeight('bold');
      }
      aba.appendRow([m.data, m.codigo, m.nome, m.placa, m.galpao, m.de, m.para, m.motivo, m.observacao, m.por].map(textoSeguro_));
    } finally {
      trava.releaseLock();
    }
    return resposta_({ ok: true });
  } catch (err) {
    return resposta_({ ok: false, erro: String(err) });
  }
}

// ---------------------------------------------------------------------
// Backup semanal no Google Drive (CSV com BOM, abre no Excel e no Sheets).
// Contém CPF: a pasta fica só no seu Drive; não compartilhe.
// ---------------------------------------------------------------------
function csv_(linhas) {
  if (!linhas.length) return '﻿';
  const colunas = Object.keys(linhas[0]);
  const esc = function (v) {
    const t = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  return '﻿' + [colunas.join(';')].concat(linhas.map(function (l) {
    return colunas.map(function (c) { return esc(l[c]); }).join(';');
  })).join('\r\n');
}

function fazerBackup() {
  const resposta = UrlFetchApp.fetch(CONFIG.URL_FUNCAO, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sync-token': token_() },
    payload: JSON.stringify({ acao: 'backup' }),
    muteHttpExceptions: true,
  });
  if (resposta.getResponseCode() !== 200) throw new Error('Falha no backup (' + resposta.getResponseCode() + '): ' + resposta.getContentText());
  const dados = JSON.parse(resposta.getContentText());
  if (dados.erro) throw new Error('Falha no backup: ' + dados.erro);

  const pastas = DriveApp.getFoldersByName(CONFIG.PASTA_BACKUP);
  const pasta = pastas.hasNext() ? pastas.next() : DriveApp.createFolder(CONFIG.PASTA_BACKUP);
  const dia = Utilities.formatDate(new Date(), FUSO, 'yyyy-MM-dd_HHmm');
  const subpasta = pasta.createFolder(dia);
  ['motoristas', 'historico', 'pedidos', 'equipe'].forEach(function (nome) {
    subpasta.createFile(nome + '_' + dia + '.csv', csv_(dados[nome] || []), MimeType.CSV);
  });

  // Mantém só os N backups mais recentes (os antigos vão para a lixeira do Drive).
  const todas = [];
  const it = pasta.getFolders();
  while (it.hasNext()) todas.push(it.next());
  todas.sort(function (a, b) { return b.getName() < a.getName() ? -1 : 1; });
  todas.slice(CONFIG.BACKUPS_MANTIDOS).forEach(function (f) { f.setTrashed(true); });

  console.log('Backup salvo em "' + CONFIG.PASTA_BACKUP + '/' + dia + '": ' +
    (dados.motoristas || []).length + ' motoristas, ' + (dados.historico || []).length + ' movimentações, ' +
    (dados.pedidos || []).length + ' pedidos.');
}

/** Rode UMA vez: sincronização a cada 15 min + backup semanal (domingo 03h). */
function instalarGatilho() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) {
      const f = t.getHandlerFunction();
      return f === 'sincronizarInativos' || f === 'sincronizarTudo' || f === 'fazerBackup';
    })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizarTudo').timeBased().everyMinutes(CONFIG.INTERVALO_MINUTOS).create();
  ScriptApp.newTrigger('fazerBackup').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  console.log('Gatilhos criados: sincronizarTudo a cada ' + CONFIG.INTERVALO_MINUTOS + ' minutos e fazerBackup aos domingos às 3h.');
}
