/**
 * Motoristas por Galpão — envia a aba INATIVOS para o app.
 *
 * Cole este arquivo em: Planilha → Extensões → Apps Script.
 * Passo a passo completo: docs/PLANILHA_SHEETS.md
 *
 * Segurança:
 *  - Só as colunas da lista COLUNAS saem da planilha. CPF, RG e endereço
 *    NUNCA são lidos nem enviados (mesmo que existam na aba).
 *  - O token fica nas Propriedades do script (não neste código).
 */

const CONFIG = {
  ABA: 'INATIVOS',
  URL_FUNCAO: 'https://idihrzbchxaptjgvsjfu.supabase.co/functions/v1/sincronizar-planilha',
  TAMANHO_LOTE: 500,
  INTERVALO_MINUTOS: 15,
};

// Campo do app → nomes de coluna aceitos (comparados sem acento, minúsculos).
const COLUNAS = {
  nome_completo: ['nome_completo', 'nome', 'motorista'],
  celular: ['celular', 'telefone', 'whatsapp'],
  placa: ['placa'],
  galpao: ['galpao'],
  modal: ['modal'],
  data: ['data_inativacao', 'data_de_inativacao', 'inativo_desde', 'data_inativo', 'data_saida', 'data_desligamento', 'data'],
  motivo: ['motivo', 'motivo_inativacao', 'motivo_da_inativacao'],
};

// Colunas que jamais podem ser enviadas.
const PROIBIDAS = /cpf|rg|endereco|logradouro|cep|bairro/;

function normalizar_(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Executado pelo gatilho a cada 15 min (ou manualmente). */
function sincronizarInativos() {
  const token = PropertiesService.getScriptProperties().getProperty('PLANILHA_SYNC_TOKEN');
  if (!token) throw new Error('Defina PLANILHA_SYNC_TOKEN em Configurações do projeto → Propriedades do script.');

  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.ABA);
  if (!aba) throw new Error('Aba "' + CONFIG.ABA + '" não encontrada.');

  const ultimaLinha = aba.getLastRow();
  const ultimaColuna = aba.getLastColumn();
  if (ultimaLinha < 2) return;

  // Descobre a posição de cada coluna permitida pelo cabeçalho.
  const cabecalho = aba.getRange(1, 1, 1, ultimaColuna).getValues()[0].map(normalizar_);
  const posicoes = {};
  Object.keys(COLUNAS).forEach(function (campo) {
    for (const nome of COLUNAS[campo]) {
      const i = cabecalho.indexOf(nome);
      if (i >= 0 && !PROIBIDAS.test(cabecalho[i])) { posicoes[campo] = i; break; }
    }
  });
  if (posicoes.placa === undefined && posicoes.celular === undefined) {
    throw new Error('A aba precisa ter a coluna "placa" ou "celular".');
  }

  // Lê SÓ as colunas permitidas (coluna a coluna), nunca a linha inteira.
  const totalLinhas = ultimaLinha - 1;
  const valores = {};
  Object.keys(posicoes).forEach(function (campo) {
    valores[campo] = aba.getRange(2, posicoes[campo] + 1, totalLinhas, 1).getValues();
  });

  const fuso = 'America/Sao_Paulo';
  const linhas = [];
  for (let r = 0; r < totalLinhas; r++) {
    const item = { linha: r + 2 };
    Object.keys(valores).forEach(function (campo) {
      let v = valores[campo][r][0];
      if (v instanceof Date) v = Utilities.formatDate(v, fuso, 'yyyy-MM-dd');
      item[campo] = v === null || v === undefined ? '' : String(v).trim();
    });
    if (item.placa || item.celular) linhas.push(item);
  }

  const total = { inativados: 0, ja_inativos: 0, ja_processados: 0, nao_encontrados: 0, erros: 0 };
  for (let i = 0; i < linhas.length; i += CONFIG.TAMANHO_LOTE) {
    const resposta = UrlFetchApp.fetch(CONFIG.URL_FUNCAO, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-sync-token': token },
      payload: JSON.stringify({ linhas: linhas.slice(i, i + CONFIG.TAMANHO_LOTE) }),
      muteHttpExceptions: true,
    });
    const codigo = resposta.getResponseCode();
    if (codigo !== 200) throw new Error('Falha ao enviar (' + codigo + '): ' + resposta.getContentText());
    const r = JSON.parse(resposta.getContentText());
    total.inativados += r.inativados;
    total.ja_inativos += r.ja_inativos;
    total.ja_processados += r.ja_processados;
    total.nao_encontrados += r.qtd_nao_encontrados;
    total.erros += (r.erros || []).length;
  }
  console.log('Sincronização: ' + JSON.stringify(total));
}

/** Rode UMA vez para agendar a sincronização automática. */
function instalarGatilho() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'sincronizarInativos'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('sincronizarInativos').timeBased().everyMinutes(CONFIG.INTERVALO_MINUTOS).create();
  console.log('Gatilho criado: a cada ' + CONFIG.INTERVALO_MINUTOS + ' minutos.');
}
