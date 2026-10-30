      /**
       * LoogiRio Frota — sincroniza a planilha interna com o app.
       *
       * Cole este arquivo em: Planilha → Extensões → Apps Script (substituindo tudo).
       * Passo a passo completo: docs/PLANILHA_SHEETS.md
       *
       * Desde 30/10/2026 os motoristas vêm DIRETO do CRM (função sincronizar-crm do app,
       * a cada 5 min). Este script manda só as ROTAS da aba "BASE - POWER BI", somadas
       * por CPF, e os treinamentos. A aba "BASE - SUPABASE" não é mais lida no automático.
       *
       * Funções para executar:
       *  - sincronizarTudo     → envia as rotas por CPF e os treinamentos das agendas.
       *  - sincronizarBase     → (reserva) envia a aba BASE - SUPABASE com as rotas, como
       *                           antes. Use só se o acesso direto ao CRM estiver fora do ar.
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
      
      /**
       * Todos os CPFs de uma célula. No Power BI, motoristas com o mesmo nome saem numa
       * linha por placa, com os CPFs juntos na mesma célula ("111... / 222..." ou "111...222...").
       */
      function cpfs_(v) {
        const lista = [];
        (String(v === null || v === undefined ? '' : v).match(/\d[\d.\-]*/g) || []).forEach(function (trecho) {
          const d = trecho.replace(/\D/g, '');
          if (d.length >= 9 && d.length <= 11) lista.push(('00' + d).slice(-11));
          else if (d.length > 11 && d.length % 11 === 0) {
            for (let i = 0; i < d.length; i += 11) lista.push(d.slice(i, i + 11));
          }
        });
        return lista.filter(function (cpf, i) { return lista.indexOf(cpf) === i; });
      }

      /** Coluna de placa da aba (primeiro cabeçalho com "placa"); sem ela, lista vazia. */
      function colunaPlaca_(aba, total) {
        const cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(normalizar_);
        const i = cabecalho.findIndex(function (c) { return /placa/.test(c); });
        if (i < 0 || total < 1) return [];
        return aba.getRange(2, i + 1, total, 1).getValues().map(function (r) { return texto_(r[0]); });
      }

      /** BASE - POWER BI → { cpf: { qtd, ultima } } (maior contagem Meli + Shopee e data mais recente). */
      function rotasPorCpf_() {
        const aba = aba_(CONFIG.ABA_ROTAS);
        const lido = lerColunas_(aba, COLUNAS_ROTAS);
        const v = lido.valores;
        const placas = colunaPlaca_(aba, lido.total);

        // Linha com um CPF vale para ele. Com vários (homônimos), o app diz de quem é
        // pela placa; sem placa conhecida, a linha não vale para ninguém.
        const donos = {};
        const divididas = [];
        for (let r = 0; r < lido.total; r++) {
          const lista = cpfs_(v.cpf[r]);
          if (lista.length === 1) donos[r] = lista[0];
          else if (lista.length > 1 && placas[r]) divididas.push({ i: r, cpfs: lista, placa: placas[r] });
        }
        if (divididas.length) {
          enviar_('resolver_placas', divididas).forEach(function (resposta) {
            resposta.forEach(function (x) { donos[x.i] = x.cpf; });
          });
        }

        const meli = {};
        const shopee = {};
        const ultima = {};
        Object.keys(donos).forEach(function (r) {
          const cpf = donos[r];
          meli[cpf] = Math.max(meli[cpf] || 0, Number(v.rotas_meli[r]) || 0);
          shopee[cpf] = Math.max(shopee[cpf] || 0, Number(v.rotas_shopee[r]) || 0);
          [dataIso_(v.ultima_meli[r]), dataIso_(v.ultima_shopee[r])].forEach(function (d) {
            if (d && (!ultima[cpf] || d > ultima[cpf])) ultima[cpf] = d;
          });
        });
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
      
      /** BASE - POWER BI → app: só as rotas, já somadas por CPF. */
      function sincronizarRotas() {
        const rotas = rotasPorCpf_();
        const linhas = Object.keys(rotas).map(function (cpf) {
          return { cpf: cpf, qtd_rotas: String(rotas[cpf].qtd), ultima_rota: rotas[cpf].ultima };
        });
        const total = { enviados: linhas.length, atualizados: 0, sem_cadastro: 0, erros: 0 };
        enviar_('rotas', linhas).forEach(function (r) {
          ['atualizados', 'sem_cadastro', 'erros'].forEach(function (k) { total[k] += r[k] || 0; });
        });
        console.log('BASE - POWER BI (rotas): ' + JSON.stringify(total) +
          ' (sem_cadastro = CPFs do Power BI que não estão no app)');
      }

      /**
       * Conferência (não envia nada ao app): mostra no registro as linhas da BASE - POWER BI
       * com mais de um CPF na mesma célula (homônimos) e as linhas cujo nome contém PROCURAR.
       * Mostra só nome, placa, CPFs e rotas.
       */
      function conferirHomonimos() {
        const PROCURAR = 'LEANDRO OLIVEIRA DA SILVA';
        const aba = aba_(CONFIG.ABA_ROTAS);
        const cabecalho = aba.getRange(1, 1, 1, aba.getLastColumn()).getValues()[0].map(normalizar_);
        const col = function (teste) { return cabecalho.findIndex(teste); };
        const iNome = col(function (c) { return /nome/.test(c) && !PROIBIDAS.test(c); });
        const iPlaca = col(function (c) { return /placa/.test(c); });
        const iCpf = cabecalho.indexOf(COLUNAS_ROTAS.cpf);
        const iMeli = cabecalho.indexOf(COLUNAS_ROTAS.rotas_meli);
        const iShopee = cabecalho.indexOf(COLUNAS_ROTAS.rotas_shopee);
        const total = aba.getLastRow() - 1;
        if (total < 1) return;
        const pegar = function (i) {
          return i < 0 ? [] : aba.getRange(2, i + 1, total, 1).getValues().map(function (r) { return texto_(r[0]); });
        };
        const nomes = pegar(iNome), placas = pegar(iPlaca), cpfs = pegar(iCpf), meli = pegar(iMeli), shopee = pegar(iShopee);
        const alvo = normalizar_(PROCURAR);
        const linhas = [];
        for (let r = 0; r < total; r++) {
          const lista = cpfs_(cpfs[r]);
          if (lista.length < 2 && !(alvo && normalizar_(nomes[r] || '').indexOf(alvo) >= 0)) continue;
          linhas.push('linha ' + (r + 2) + ': ' + (nomes[r] || '?') + ' | placa ' + (placas[r] || '-') +
            ' | CPFs ' + (lista.join(', ') || '-') + ' | rotas Meli ' + (meli[r] || 0) + ', Shopee ' + (shopee[r] || 0));
        }
        console.log((iNome < 0 ? '(coluna de nome não encontrada)\n' : '') +
          linhas.length + ' linha(s):\n' + linhas.join('\n'));
      }

      // ---------------------------------------------------------------------
      // Treinamentos: agendas dos galpões (Google Agenda) → app.
      // Os IDs das agendas ficam na propriedade do script AGENDAS_TREINAMENTO,
      // em JSON: {"SRJ1":"...@group.calendar.google.com", "SRJ2":"...", ...}.
      // Só vão eventos cujo título começa com TREINAMENTO; descrição com TESTE é ignorada.
      // Da descrição sai só o telefone do motorista.
      // ---------------------------------------------------------------------
      const TREINAMENTO_DIAS_ANTES = 7;
      const TREINAMENTO_DIAS_DEPOIS = 60;
      
      function agendas_() {
        const bruto = PropertiesService.getScriptProperties().getProperty('AGENDAS_TREINAMENTO');
        if (!bruto) return null;
        try {
          return JSON.parse(bruto);
        } catch (e) {
          throw new Error('A propriedade AGENDAS_TREINAMENTO não é um JSON válido.');
        }
      }
      
      /** Primeiro telefone da descrição (10 ou 11 dígitos, com ou sem 55). */
      function telefoneDaDescricao_(texto) {
        const achado = String(texto || '').replace(/<[^>]*>/g, ' ').match(/(\+?55[\s.-]*)?\(?\d{2}\)?[\s.-]*9?\d{4}[\s.-]*\d{4}/);
        if (!achado) return '';
        const d = achado[0].replace(/\D/g, '');
        return d.length > 11 && d.indexOf('55') === 0 ? d.slice(2) : d;
      }
      
      function sincronizarTreinamentos() {
        const agendas = agendas_();
        if (!agendas) {
          console.log('Treinamentos: defina a propriedade AGENDAS_TREINAMENTO para ligar. Pulando.');
          return;
        }
        const agora = new Date();
        const de = new Date(agora.getTime() - TREINAMENTO_DIAS_ANTES * 864e5);
        const ate = new Date(agora.getTime() + TREINAMENTO_DIAS_DEPOIS * 864e5);
        const eventos = [];
        Object.keys(agendas).forEach(function (galpao) {
          const agenda = CalendarApp.getCalendarById(agendas[galpao]);
          if (!agenda) throw new Error('Agenda do ' + galpao + ' não encontrada (confira o ID e o compartilhamento).');
          agenda.getEvents(de, ate).forEach(function (ev) {
            const titulo = String(ev.getTitle() || '').trim();
            if (!/^TREINAMENTO\b/i.test(titulo)) return;
            const descricao = ev.getDescription() || '';
            if (/TESTE/i.test(descricao)) return;
            const nome = titulo.replace(/^TREINAMENTO\s*/i, '').replace(new RegExp('\\s*' + galpao + '\\s*$', 'i'), '').trim();
            eventos.push({
              evento_id: ev.getId(),
              galpao: galpao,
              nome: nome,
              telefone: telefoneDaDescricao_(descricao),
              inicio: ev.getStartTime().toISOString(),
            });
          });
        });
      
        const resposta = UrlFetchApp.fetch(CONFIG.URL_FUNCAO, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-sync-token': token_() },
          payload: JSON.stringify({ acao: 'treinamentos', eventos: eventos, de: de.toISOString(), ate: ate.toISOString() }),
          muteHttpExceptions: true,
        });
        if (resposta.getResponseCode() !== 200) {
          throw new Error('Falha ao enviar treinamentos (' + resposta.getResponseCode() + '): ' + resposta.getContentText());
        }
        console.log('Treinamentos: ' + eventos.length + ' na agenda → ' + resposta.getContentText());
      }
      
      /** Executado pelo gatilho. Uma parte com erro não impede a outra. */
      function sincronizarTudo() {
        const falhas = [];
        [sincronizarRotas, sincronizarTreinamentos].forEach(function (passo) {
          try {
            passo();
          } catch (e) {
            console.error(passo.name + ': ' + e);
            falhas.push(passo.name + ': ' + e);
          }
        });
        if (falhas.length) throw new Error(falhas.join('\n'));
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
