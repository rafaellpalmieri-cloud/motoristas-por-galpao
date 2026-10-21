/**
 * Motoristas por Galpão — sincroniza a planilha interna com o app.
 *
 * Cole este arquivo em: Planilha → Extensões → Apps Script (substituindo tudo).
 * Passo a passo completo: docs/PLANILHA_SHEETS.md
 *
 * Funções para executar:
 *  - preencherCodigos   → UMA vez: cria/preenche a coluna "codigo" nas abas ATIVOS e INATIVOS
 *                          com o código que o motorista já tem no app (busca por placa/celular).
 *  - gerarCodigosNovos  → dá código (M0001...) aos motoristas novos da aba ATIVOS que
 *                          o app ainda não conhece. Também roda dentro do sincronizarTudo.
 *  - sincronizarTudo    → gera códigos novos, envia ATIVOS (novos e dados atualizados)
 *                          e depois INATIVOS (inativações).
 *  - instalarGatilho    → UMA vez: agenda sincronizarTudo a cada 15 minutos e o
 *                          backup semanal (domingo de madrugada).
 *  - fazerBackup        → salva no seu Google Drive uma cópia (CSV) de motoristas,
 *                          histórico, pedidos e equipe. Mantém os 12 últimos.
 *  - doPost             → recebe do app as movimentações (aba "MOVIMENTAÇÕES APP");
 *                          só funciona depois de Implantar → App da Web.
 *
 * Segurança:
 *  - Só as colunas da lista COLUNAS saem da planilha. RG e endereço NUNCA
 *    são lidos nem enviados. CPF e rotas vão das duas abas (na INATIVOS,
 *    só para completar o cadastro, sem mudar status).
 *  - O token fica nas Propriedades do script (não neste código).
 */

const CONFIG = {
  ABA_ATIVOS: 'ATIVOS',
  ABA_INATIVOS: 'INATIVOS',
  URL_FUNCAO: 'https://idihrzbchxaptjgvsjfu.supabase.co/functions/v1/sincronizar-planilha',
  TAMANHO_LOTE: 200,
  PASTA_BACKUP: 'Backups - Motoristas por Galpão',
  BACKUPS_MANTIDOS: 12,
  INTERVALO_MINUTOS: 15,
};

// Campo do app → nomes de coluna aceitos (comparados sem acento, minúsculos).
const COLUNAS = {
  codigo: ['codigo', 'cod', 'codigo_motorista'],
  nome_completo: ['nome_completo', 'nome', 'motorista'],
  celular: ['celular', 'telefone', 'whatsapp'],
  placa: ['placa'],
  galpao: ['galpao'],
  modal: ['modal'],
  data: ['data_inativacao', 'data_de_inativacao', 'inativo_desde', 'data_inativo', 'data_saida', 'data_desligamento', 'data'],
  motivo: ['motivo', 'motivo_inativacao', 'motivo_da_inativacao'],
  cpf: ['cpf'],
  realizou_rotas: ['realizou_rotas', 'fez_rota', 'fez_rotas'],
  qtd_rotas: ['qntd_rotas', 'qtd_rotas', 'quantidade_rotas', 'quantidade_de_rotas'],
  ultima_rota: ['ultima_rota', 'data_ultima_rota'],
};

// Colunas que jamais podem ser lidas ou enviadas.
const PROIBIDAS = /^rg$|_rg$|^rg_|endereco|logradouro|cep|bairro/;

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

/** Posição (0-based) de cada campo permitido, pelo cabeçalho. */
function posicoes_(aba) {
  const cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(normalizar_);
  const pos = {};
  Object.keys(COLUNAS).forEach(function (campo) {
    for (const nome of COLUNAS[campo]) {
      const i = cabecalho.indexOf(nome);
      if (i >= 0 && !PROIBIDAS.test(cabecalho[i])) { pos[campo] = i; break; }
    }
  });
  return pos;
}

/** Lê SÓ as colunas pedidas (coluna a coluna, nunca a linha inteira). */
function lerLinhas_(aba, pos, campos) {
  const total = aba.getLastRow() - 1;
  if (total < 1) return [];
  const valores = {};
  campos.forEach(function (campo) {
    if (pos[campo] !== undefined) valores[campo] = aba.getRange(2, pos[campo] + 1, total, 1).getValues();
  });
  const fuso = 'America/Sao_Paulo';
  const linhas = [];
  for (let r = 0; r < total; r++) {
    const item = { linha: r + 2 };
    Object.keys(valores).forEach(function (campo) {
      let v = valores[campo][r][0];
      if (v instanceof Date) v = Utilities.formatDate(v, fuso, 'yyyy-MM-dd');
      item[campo] = v === null || v === undefined ? '' : String(v).trim();
    });
    linhas.push(item);
  }
  return linhas;
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

/** Aba ATIVOS → app: cadastra motoristas novos e atualiza dados (não muda status). */
function sincronizarAtivos() {
  const aba = aba_(CONFIG.ABA_ATIVOS);
  const pos = posicoes_(aba);
  if (pos.codigo === undefined) {
    console.log('Aba ATIVOS sem coluna "codigo": rode preencherCodigos primeiro. Pulando ATIVOS.');
    return;
  }
  const linhas = lerLinhas_(aba, pos, ['codigo', 'nome_completo', 'celular', 'placa', 'galpao', 'modal',
                                       'cpf', 'realizou_rotas', 'qtd_rotas', 'ultima_rota'])
    .filter(function (l) { return l.codigo; });
  const total = { novos: 0, atualizados: 0, erros: 0, sem_codigo: aba.getLastRow() - 1 - linhas.length };
  const exemplosErro = [];
  enviar_('ativos', linhas).forEach(function (r) {
    total.novos += r.novos;
    total.atualizados += r.atualizados;
    total.erros += r.erros.length;
    r.erros.slice(0, 10 - exemplosErro.length).forEach(function (e) { exemplosErro.push('linha ' + e.linha + ': ' + e.erro); });
  });
  console.log('ATIVOS: ' + JSON.stringify(total) + (exemplosErro.length ? '\n  ' + exemplosErro.join('\n  ') : ''));
}

/** Aba INATIVOS → app: inativa quem ainda está ativo no app (gera alerta). */
function sincronizarInativos() {
  const aba = aba_(CONFIG.ABA_INATIVOS);
  const pos = posicoes_(aba);
  if (pos.codigo === undefined && pos.placa === undefined && pos.celular === undefined) {
    throw new Error('A aba INATIVOS precisa ter a coluna "codigo", "placa" ou "celular".');
  }
  const linhas = lerLinhas_(aba, pos, ['codigo', 'nome_completo', 'celular', 'placa', 'galpao', 'modal', 'data', 'motivo'])
    .filter(function (l) { return l.codigo || l.placa || l.celular; });
  const total = { inativados: 0, ja_inativos: 0, ja_processados: 0, nao_encontrados: 0, ambiguos: 0, erros: 0 };
  const ambiguos = [];
  enviar_('inativos', linhas).forEach(function (r) {
    total.inativados += r.inativados;
    total.ja_inativos += r.ja_inativos;
    total.ja_processados += r.ja_processados;
    total.nao_encontrados += r.qtd_nao_encontrados;
    total.ambiguos += (r.ambiguos || []).length;
    total.erros += (r.erros || []).length;
    (r.ambiguos || []).forEach(function (a) { if (ambiguos.length < 50) ambiguos.push(a.linha); });
  });
  console.log('INATIVOS: ' + JSON.stringify(total) +
    (ambiguos.length ? '\n  Placa repetida sem desempate (preencha o código): linhas ' + ambiguos.join(', ') : ''));

  // CPF e rotas de quem está na aba INATIVOS (só completa o cadastro).
  if (pos.cpf !== undefined || pos.qtd_rotas !== undefined || pos.realizou_rotas !== undefined || pos.ultima_rota !== undefined) {
    const complemento = lerLinhas_(aba, pos, ['codigo', 'nome_completo', 'celular', 'placa', 'cpf', 'realizou_rotas', 'qtd_rotas', 'ultima_rota'])
      .filter(function (l) { return (l.codigo || l.placa || l.celular) && (l.cpf || l.qtd_rotas || l.realizou_rotas || l.ultima_rota); });
    const soma = { atualizados: 0, nao_encontrados: 0, ambiguos: 0, erros: 0 };
    enviar_('complemento', complemento).forEach(function (r) {
      soma.atualizados += r.atualizados;
      soma.nao_encontrados += r.nao_encontrados;
      soma.ambiguos += r.ambiguos;
      soma.erros += (r.erros || []).length;
    });
    console.log('INATIVOS (CPF/rotas): ' + JSON.stringify(soma));
  }
}

/** Executado pelo gatilho: primeiro ATIVOS (novos entram), depois INATIVOS. */
function sincronizarTudo() {
  gerarCodigosNovos();
  sincronizarAtivos();
  sincronizarInativos();
}

/**
 * UMA vez: cria a coluna "codigo" (se não existir) nas abas ATIVOS e INATIVOS
 * e preenche as células vazias com o código do app, buscando por placa/celular.
 * Não apaga nem altera códigos já preenchidos.
 */
function preencherCodigos() {
  [CONFIG.ABA_ATIVOS, CONFIG.ABA_INATIVOS].forEach(function (nomeAba) {
    const aba = aba_(nomeAba);
    let pos = posicoes_(aba);
    if (pos.codigo === undefined) {
      const coluna = aba.getLastColumn() + 1;
      aba.getRange(1, coluna).setValue('codigo');
      pos = posicoes_(aba);
    }
    const total = aba.getLastRow() - 1;
    if (total < 1) return;

    const faixaCodigo = aba.getRange(2, pos.codigo + 1, total, 1);
    const codigos = faixaCodigo.getValues();
    const todas = lerLinhas_(aba, pos, ['placa', 'celular', 'nome_completo']);
    const semCodigo = todas.filter(function (l) { return !String(codigos[l.linha - 2][0]).trim(); });
    const linhas = semCodigo
      .filter(function (l) { return l.placa || l.celular; })
      .map(function (l) { return { linha: l.linha, placa: l.placa, celular: l.celular, nome_completo: l.nome_completo }; });

    const resumo = {
      preenchidos: 0,
      nao_encontrados: 0,
      ambiguos: 0,
      ja_tinham: total - semCodigo.length,
      sem_placa_e_celular: semCodigo.length - linhas.length,
    };
    const pendentes = [];
    enviar_('buscar_codigos', linhas).forEach(function (lote) {
      lote.forEach(function (r) {
        if (r.situacao === 'ok') {
          codigos[Number(r.linha) - 2][0] = r.codigo;
          resumo.preenchidos++;
        } else {
          resumo[r.situacao === 'ambiguo' ? 'ambiguos' : 'nao_encontrados']++;
          if (pendentes.length < 80) pendentes.push(r.linha + (r.situacao === 'ambiguo' ? ' (placa repetida)' : ''));
        }
      });
    });

    faixaCodigo.setNumberFormat('@'); // texto: não perde zeros à esquerda
    faixaCodigo.setValues(codigos);
    console.log(nomeAba + ': ' + JSON.stringify(resumo) +
      (pendentes.length ? '\n  Preencha à mão as linhas: ' + pendentes.join(', ') : ''));
  });
}

/**
 * Dá código novo (M0001, M0002...) aos motoristas NOVOS da aba ATIVOS: linhas sem
 * código, com nome e placa/celular, que o app não encontra nem pela placa nem pelo
 * celular. O número é o seguinte ao maior já usado na planilha (as duas abas) ou no app.
 * Quem o app já conhece não recebe código novo (use preencherCodigos).
 * Roda sozinho no sincronizarTudo; pode ser executado à mão também.
 */
function gerarCodigosNovos() {
  const trava = LockService.getScriptLock();
  trava.waitLock(30000);
  try {
    const aba = aba_(CONFIG.ABA_ATIVOS);
    const pos = posicoes_(aba);
    const total = aba.getLastRow() - 1;
    if (pos.codigo === undefined || total < 1) return;

    const faixaCodigo = aba.getRange(2, pos.codigo + 1, total, 1);
    const codigos = faixaCodigo.getValues();
    const candidatas = lerLinhas_(aba, pos, ['nome_completo', 'placa', 'celular'])
      .filter(function (l) { return !String(codigos[l.linha - 2][0]).trim() && l.nome_completo; });
    if (!candidatas.length) return;

    const semContato = candidatas.filter(function (l) { return !l.placa && !l.celular; });
    const novas = [];
    const conhecidas = [];
    enviar_('buscar_codigos', candidatas
      .filter(function (l) { return l.placa || l.celular; })
      .map(function (l) { return { linha: l.linha, placa: l.placa, celular: l.celular }; }))
      .forEach(function (lote) {
        lote.forEach(function (r) { (r.situacao === 'nao_encontrado' ? novas : conhecidas).push(Number(r.linha)); });
      });

    if (novas.length) {
      const formato = /^M(\d+)$/i;
      let maior = 0;
      let digitos = 4;
      const considerar = function (c) {
        const m = formato.exec(String(c || '').trim());
        if (!m) return;
        maior = Math.max(maior, Number(m[1]));
        digitos = Math.max(digitos, m[1].length);
      };
      codigos.forEach(function (c) { considerar(c[0]); });
      const inativos = aba_(CONFIG.ABA_INATIVOS);
      const posInativos = posicoes_(inativos);
      if (posInativos.codigo !== undefined && inativos.getLastRow() > 1) {
        inativos.getRange(2, posInativos.codigo + 1, inativos.getLastRow() - 1, 1).getValues()
          .forEach(function (c) { considerar(c[0]); });
      }
      codigosDoApp_().forEach(considerar);

      novas.sort(function (a, b) { return a - b; }).forEach(function (linha) {
        maior++;
        codigos[linha - 2][0] = 'M' + String(maior).padStart(digitos, '0');
      });
      faixaCodigo.setNumberFormat('@');
      faixaCodigo.setValues(codigos);
    }

    console.log('CÓDIGOS NOVOS: ' + JSON.stringify({ gerados: novas.length, ja_no_app: conhecidas.length, sem_placa_e_celular: semContato.length }) +
      (novas.length ? '\n  Gerados nas linhas: ' + novas.map(function (l) { return l + ' → ' + codigos[l - 2][0]; }).join(', ') : '') +
      (conhecidas.length ? '\n  Já existem no app (rode preencherCodigos ou preencha à mão): ' + conhecidas.slice(0, 80).join(', ') : '') +
      (semContato.length ? '\n  Sem placa e sem celular (preencha um dos dois): ' + semContato.slice(0, 80).map(function (l) { return l.linha; }).join(', ') : ''));
  } finally {
    trava.releaseLock();
  }
}

/** Todos os códigos que já existem no app (lidos pela mesma rota do backup). */
function codigosDoApp_() {
  const resposta = UrlFetchApp.fetch(CONFIG.URL_FUNCAO, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-sync-token': token_() },
    payload: JSON.stringify({ acao: 'backup' }),
    muteHttpExceptions: true,
  });
  if (resposta.getResponseCode() !== 200) throw new Error('Falha ao ler os códigos do app (' + resposta.getResponseCode() + '): ' + resposta.getContentText());
  const dados = JSON.parse(resposta.getContentText());
  if (dados.erro) throw new Error('Falha ao ler os códigos do app: ' + dados.erro);
  return (dados.motoristas || []).map(function (m) { return m.codigo; });
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
  if (!linhas.length) return '\uFEFF';
  const colunas = Object.keys(linhas[0]);
  const esc = function (v) {
    const t = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  return '\uFEFF' + [colunas.join(';')].concat(linhas.map(function (l) {
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
  const dia = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd_HHmm');
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
