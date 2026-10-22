(function () {
    var t = null;
    try { t = localStorage.getItem('tema'); } catch (e) { }
    if (t !== 'dark' && t !== 'light') {
        t = (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', t);
})();

var acTimeout = null;
var selectedUsers = [];
var buscaAtiva = false;
var refreshDeadline = 0;
var refreshLabelTimer = null;
var REFRESH_INTERVAL = 60;
var timerWorker = null;
var timerGeneration = 0;
var knownIssues = {};
var pendingCount = 0;
var pendingTiposRestore = null;
var pendingVerticalRestore = null;
var pendingPortfolioRestore = null;
var pendingEquipeRestore = null;
var pendingAutoSearch = false;
var pendingSortRestore = false;
var buscarController = null;

var inpUser = document.getElementById('inp-user');
var acList = document.getElementById('autocomplete-list');

var mostrarParceiros = false;

document.getElementById('chk-parceiros').addEventListener('change', function () {
    mostrarParceiros = this.checked;
    if (buscaAtiva) buscar();
});

function escHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function temaAtual() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function atualizarBotaoTema() {
    var btn = document.getElementById('theme-btn');
    if (!btn) return;
    var escuro = temaAtual() === 'dark';
    btn.textContent = escuro ? '☀️' : '🌙';
    btn.title = escuro ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
    btn.setAttribute('aria-label', btn.title);
}

function aplicarTema(tema, salvar) {
    document.documentElement.setAttribute('data-theme', tema);
    if (salvar) { try { localStorage.setItem('tema', tema); } catch (e) { } }
    atualizarBotaoTema();
}

function alternarTema() {
    aplicarTema(temaAtual() === 'dark' ? 'light' : 'dark', true);
}

atualizarBotaoTema();

if (window.matchMedia) {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        var salvo = null;
        try { salvo = localStorage.getItem('tema'); } catch (err) { }
        if (salvo !== 'dark' && salvo !== 'light') aplicarTema(e.matches ? 'dark' : 'light', false);
    });
}

function setBadge(online) {
    var badge = document.getElementById('status-badge');
    badge.textContent = online ? 'Online' : 'Offline';
    badge.style.background = online ? '#00C851' : '#e53935';
}

fetch('/api/tipos')
    .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
    })
    .then(function (data) {
        setBadge(data.ok);
        if (data.ok && data.tipos) initTipos(data.tipos);
    })
    .catch(function () {
        setBadge(false);
        if (pendingAutoSearch) { pendingAutoSearch = false; buscar(); }
    });


inpUser.addEventListener('input', function () {
    clearTimeout(acTimeout);
    inpUser.classList.remove('inp-warn');
    var q = inpUser.value.trim();
    if (q.length < 2) { acList.classList.remove('open'); return; }
    acTimeout = setTimeout(function () { fetchUsuarios(q); }, 300);
});

inpUser.addEventListener('blur', function () {
    setTimeout(function () {
        if (!acList.contains(document.activeElement)) {
            acList.classList.remove('open');
            if (inpUser.value.trim()) inpUser.classList.add('inp-warn');
        }
    }, 150);
});

inpUser.addEventListener('focus', function () {
    inpUser.classList.remove('inp-warn');
});

inpUser.addEventListener('keydown', function (e) {
    var items = acList.querySelectorAll('.autocomplete-item');
    var arr = Array.prototype.slice.call(items);
    var idx = arr.findIndex(function (i) { return i.classList.contains('selected'); });
    if (e.key === 'ArrowDown') { e.preventDefault(); setAcFocus(items, Math.min(idx + 1, items.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAcFocus(items, Math.max(idx - 1, 0)); }
    if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); items[idx].click(); }
    if (e.key === 'Escape') { acList.classList.remove('open'); inpUser.blur(); }
});

function setAcFocus(items, idx) {
    Array.prototype.forEach.call(items, function (i) { i.classList.remove('selected'); });
    if (idx >= 0 && idx < items.length) items[idx].classList.add('selected');
}

function fetchUsuarios(q) {
    inpUser.style.backgroundImage = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\'%3E%3Ccircle cx=\'12\' cy=\'12\' r=\'10\' stroke=\'%232F6FD0\' stroke-width=\'3\' fill=\'none\' stroke-dasharray=\'31.4\' stroke-dashoffset=\'10\'%3E%3CanimateTransform attributeName=\'transform\' type=\'rotate\' from=\'0 12 12\' to=\'360 12 12\' dur=\'0.7s\' repeatCount=\'indefinite\'/%3E%3C/circle%3E%3C/svg%3E")';
    inpUser.style.backgroundRepeat = 'no-repeat';
    inpUser.style.backgroundPosition = 'right 10px center';
    fetch('/api/usuarios?q=' + encodeURIComponent(q))
        .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(function (data) {
            var seenNames = {};
            var seenEmails = {};
            var users = (data.users || []).filter(function (u) {
                var nameKey = (u.name || '').toLowerCase();
                var emailKey = (u.email || '').toLowerCase();
                if (seenNames[nameKey]) return false;
                if (emailKey && seenEmails[emailKey]) return false;
                seenNames[nameKey] = true;
                if (emailKey) seenEmails[emailKey] = true;
                return !selectedUsers.some(function (s) {
                    return (s.name || '').toLowerCase() === nameKey ||
                        (emailKey && (s.email || '').toLowerCase() === emailKey);
                });
            });
            acList.innerHTML = '';
            if (!users.length) { acList.classList.remove('open'); return; }
            users.forEach(function (u) {
                var item = document.createElement('div');
                item.className = 'autocomplete-item';
                item.addEventListener('mousedown', function (e) { e.preventDefault(); });
                item.addEventListener('click', function () {
                    clearTimeout(acTimeout);
                    adicionarUserTag(u);
                    inpUser.value = '';
                    inpUser.classList.remove('inp-warn');
                    acList.classList.remove('open');
                    buscar();
                });
                var nameEl = document.createElement('span');
                nameEl.textContent = u.displayName;
                var emailEl = document.createElement('span');
                emailEl.style.fontSize = '11px';
                emailEl.style.color = 'var(--text-secondary)';
                emailEl.textContent = u.email;
                item.appendChild(nameEl);
                item.appendChild(emailEl);
                acList.appendChild(item);
            });
            acList.classList.add('open');
        })
        .catch(function () { acList.classList.remove('open'); })
        .finally(function () { inpUser.style.backgroundImage = ''; });
}

var tiposSelected = new Set();
var multiSelected = {
    vertical: new Set(),
    portfolio: new Set(),
    equipe: new Set(),
};
var tiposNomeMap = {};

var TIPOS_PRIORITARIOS = [
    'Acompanhamento técnico', 'Capacitação', 'Configuração', 'Customização',
    'Dúvida', 'Incidente', 'Tratamento de dados', 'Treinamento',
];

var VERTICAIS_OPCOES = [
    'Arrecadação', 'Atendimento', 'Contratos', 'Contábil',
    'Educação', 'Pessoal', 'Saúde',
];

var PORTFOLIOS_OPCOES = [
    { value: 'Portfólio Pequenas Contas', label: 'Pequenas Contas' },
    { value: 'Portfólio Médias Contas', label: 'Médias Contas' },
    { value: 'Portfólio SC/MG', label: 'SC/MG' },
    { value: 'Portfólio SC/SP', label: 'SC/SP' },
];

var EQUIPES_OPCOES = ['Suporte', 'Serviço', 'Produto'];

function aplicarMultiRestore(namespace, keys) {
    multiSelected[namespace].clear();
    document.querySelectorAll('#' + namespace + '-items input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
    keys.forEach(function (key) {
        multiSelected[namespace].add(key);
        var cb = document.querySelector('#' + namespace + '-items input[value="' + key + '"]');
        if (cb) cb.checked = true;
    });
    atualizarMultiLabel(namespace);
}

function initTipos(tipos) {
    var container = document.getElementById('tipo-items');
    container.innerHTML = '';
    tiposNomeMap = {};
    tiposSelected.clear();

    var prioritarios = [];
    var restantes = [];
    tipos.forEach(function (tipo) {
        var name = typeof tipo === 'string' ? tipo : tipo.name;
        if (TIPOS_PRIORITARIOS.indexOf(name) >= 0) prioritarios.push(tipo);
        else restantes.push(tipo);
    });
    prioritarios.sort(function (a, b) {
        var na = typeof a === 'string' ? a : a.name;
        var nb = typeof b === 'string' ? b : b.name;
        return TIPOS_PRIORITARIOS.indexOf(na) - TIPOS_PRIORITARIOS.indexOf(nb);
    });
    restantes.sort(function (a, b) {
        var na = typeof a === 'string' ? a : a.name;
        var nb = typeof b === 'string' ? b : b.name;
        return na.localeCompare(nb, 'pt-BR');
    });
    var ordenados = prioritarios.concat(restantes);
    var haRestantes = restantes.length > 0;

    ordenados.forEach(function (tipo, idx) {
        var name = typeof tipo === 'string' ? tipo : tipo.name;
        var ids = typeof tipo === 'string' ? [tipo] : (tipo.ids || [String(tipo.name)]);
        var key = ids.join(',');
        var isPrioritario = TIPOS_PRIORITARIOS.indexOf(name) >= 0;
        tiposNomeMap[key] = name;

        if (haRestantes && idx === prioritarios.length) {
            var sep = document.createElement('div');
            sep.className = 'tipo-separator';
            sep.style.cssText = 'border-top:1px solid var(--gray-border);margin:4px 0;';
            container.appendChild(sep);
        }

        var label = document.createElement('label');
        label.className = 'multiselect-item';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = key;

        if (isPrioritario) {
            cb.checked = true;
            tiposSelected.add(key);
        }

        cb.addEventListener('change', function () {
            if (cb.checked) tiposSelected.add(key);
            else tiposSelected.delete(key);
            atualizarTipoLabel();
            buscar();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(name));
        container.appendChild(label);
    });

    if (pendingTiposRestore) {
        tiposSelected.clear();
        document.querySelectorAll('#tipo-items input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
        pendingTiposRestore.forEach(function (key) {
            tiposSelected.add(key);
            var cb = document.querySelector('#tipo-items input[value="' + key + '"]');
            if (cb) cb.checked = true;
        });
        pendingTiposRestore = null;
    }

    atualizarTipoLabel();

    if (pendingAutoSearch) {
        pendingAutoSearch = false;
        buscar();
    }
}

function toggleTipoDropdown() {
    var btn = document.getElementById('tipo-btn');
    var dd = document.getElementById('tipo-dropdown');
    var isOpening = !dd.classList.contains('open');
    btn.classList.toggle('open');
    dd.classList.toggle('open');
    if (isOpening) {
        var search = document.getElementById('tipo-search');
        search.value = '';
        filtrarTipos('');
        setTimeout(function () { search.focus(); }, 50);
    }
}

function filtrarTipos(q) {
    var termo = q.toLowerCase();
    document.querySelectorAll('#tipo-items .multiselect-item').forEach(function (item) {
        var nome = item.textContent.trim().toLowerCase();
        item.style.display = nome.includes(termo) ? '' : 'none';
    });
    var sep = document.querySelector('#tipo-items .tipo-separator');
    if (!sep) return;
    var items = Array.prototype.slice.call(document.querySelectorAll('#tipo-items .multiselect-item'));
    var sepIdx = Array.prototype.indexOf.call(sep.parentNode.children, sep);
    var visibleBefore = items.filter(function (el) {
        return Array.prototype.indexOf.call(sep.parentNode.children, el) < sepIdx && el.style.display !== 'none';
    }).length;
    var visibleAfter = items.filter(function (el) {
        return Array.prototype.indexOf.call(sep.parentNode.children, el) > sepIdx && el.style.display !== 'none';
    }).length;
    sep.style.display = (visibleBefore > 0 && visibleAfter > 0) ? '' : 'none';
}

function selecionarTodosTipos() {
    tiposSelected.clear();
    document.querySelectorAll('#tipo-items .multiselect-item').forEach(function (item) {
        if (item.style.display === 'none') return;
        var cb = item.querySelector('input[type=checkbox]');
        if (cb) { cb.checked = true; tiposSelected.add(cb.value); }
    });
    atualizarTipoLabel();
    buscar();
}

function limparTipos() {
    tiposSelected.clear();
    document.querySelectorAll('#tipo-items input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
    atualizarTipoLabel();
    buscar();
}

function atualizarTipoLabel() {
    var label = document.getElementById('tipo-label');
    var btn = document.getElementById('tipo-btn');
    var totalDisponivel = document.querySelectorAll('#tipo-items input[type=checkbox]').length;
    var todosSelecionados = tiposSelected.size >= totalDisponivel && totalDisponivel > 0;

    if (tiposSelected.size === 0 || todosSelecionados) {
        label.innerHTML = 'Todos os tipos';
        var badge = btn.querySelector('.multiselect-badge');
        if (badge) badge.remove();
    } else {
        var arrKeys = [];
        tiposSelected.forEach(function (k) { arrKeys.push(k); });
        var nomes = arrKeys.map(function (k) { return tiposNomeMap[k] || k; });
        label.textContent = tiposSelected.size === 1
            ? nomes[0]
            : tiposSelected.size + ' tipos';
        var badge = btn.querySelector('.multiselect-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'multiselect-badge';
            btn.appendChild(badge);
        }
        badge.textContent = tiposSelected.size;
    }
}

function initMultiSelect(namespace, opcoes) {
    var container = document.getElementById(namespace + '-items');
    container.innerHTML = '';
    multiSelected[namespace].clear();

    opcoes.forEach(function (opcao) {
        var value = typeof opcao === 'string' ? opcao : opcao.value;
        var label = typeof opcao === 'string' ? opcao : opcao.label;

        var lbl = document.createElement('label');
        lbl.className = 'multiselect-item';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = value;

        cb.addEventListener('change', function () {
            if (cb.checked) multiSelected[namespace].add(value);
            else multiSelected[namespace].delete(value);
            atualizarMultiLabel(namespace);
            buscar();
        });

        lbl.appendChild(cb);
        lbl.appendChild(document.createTextNode(label));
        container.appendChild(lbl);
    });
}

function toggleMultiDropdown(namespace) {
    var btn = document.getElementById(namespace + '-btn');
    var dd = document.getElementById(namespace + '-dropdown');
    btn.classList.toggle('open');
    dd.classList.toggle('open');
}

function selecionarTodosMulti(namespace) {
    multiSelected[namespace].clear();
    document.querySelectorAll('#' + namespace + '-items input[type=checkbox]').forEach(function (cb) {
        cb.checked = true;
        multiSelected[namespace].add(cb.value);
    });
    atualizarMultiLabel(namespace);
    buscar();
}

function limparMulti(namespace) {
    multiSelected[namespace].clear();
    document.querySelectorAll('#' + namespace + '-items input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
    atualizarMultiLabel(namespace);
    buscar();
}

function atualizarMultiLabel(namespace) {
    var label = document.getElementById(namespace + '-label');
    var btn = document.getElementById(namespace + '-btn');
    var totalDisponivel = document.querySelectorAll('#' + namespace + '-items input[type=checkbox]').length;
    var selected = multiSelected[namespace];
    var todosSelecionados = selected.size >= totalDisponivel && totalDisponivel > 0;
    var textoTodos = namespace === 'vertical' ? 'Todas as verticais'
        : namespace === 'equipe' ? 'Todas as equipes'
            : 'Todos os portfólios';

    if (selected.size === 0 || todosSelecionados) {
        label.textContent = textoTodos;
        var badge = btn.querySelector('.multiselect-badge');
        if (badge) badge.remove();
    } else {
        var arr = [];
        selected.forEach(function (v) { arr.push(v); });
        if (selected.size === 1) {
            var opcaoUnica = namespace === 'portfolio'
                ? abrevPortfolio(arr[0])
                : arr[0];
            label.textContent = opcaoUnica;
        } else {
            label.textContent = selected.size + (
                namespace === 'vertical' ? ' verticais'
                    : namespace === 'equipe' ? ' equipes'
                        : ' portfólios'
            );
        }
        var badge = btn.querySelector('.multiselect-badge');
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'multiselect-badge';
            btn.appendChild(badge);
        }
        badge.textContent = selected.size;
    }
}

document.addEventListener('click', function (e) {
    ['tipo', 'vertical', 'portfolio', 'equipe'].forEach(function (namespace) {
        var wrap = document.getElementById(namespace + '-wrap');
        if (wrap && !wrap.contains(e.target)) {
            document.getElementById(namespace + '-btn').classList.remove('open');
            document.getElementById(namespace + '-dropdown').classList.remove('open');
        }
    });
});

function buscar(silencioso) {
    if (buscarController) {
        buscarController.abort();
    }
    buscarController = new AbortController();

    var verticalArr = [];
    multiSelected.vertical.forEach(function (v) { verticalArr.push(v); });
    var portfolioArr = [];
    multiSelected.portfolio.forEach(function (p) { portfolioArr.push(p); });
    var equipeArr = [];
    multiSelected.equipe.forEach(function (e) { equipeArr.push(e); });
    var userNames = selectedUsers.map(function (u) { return u.name; });

    if (inpUser.value.trim()) {
        if (!silencioso) {
            inpUser.classList.add('inp-warn');
            _lastSignature = null;
            document.getElementById('results').innerHTML =
                '<div class="state"><div class="state-icon">⚠️</div>' +
                'Selecione um responsável <strong>da lista</strong> — o texto digitado não é um filtro válido.' +
                '</div>';
            document.getElementById('chips').style.display = 'none';
        } else if (buscaAtiva) { agendarProximoRefresh(); }
        return;
    }

    var temSaudeOuEducacao = verticalArr.some(function (v) {
        var vLower = v.toLowerCase();
        return vLower === 'saúde' || vLower === 'educação';
    });
    var portfolioBtn = document.getElementById('portfolio-btn');
    if (temSaudeOuEducacao) {
        if (portfolioArr.length > 0) {
            portfolioArr = [];
            multiSelected.portfolio.clear();
            document.querySelectorAll('#portfolio-items input[type=checkbox]').forEach(function (cb) { cb.checked = false; });
            atualizarMultiLabel('portfolio');
        }
        portfolioBtn.disabled = true;
        portfolioBtn.title = 'Portfólio não aplicável quando Saúde ou Educação está selecionada';
        document.getElementById('portfolio-dropdown').classList.remove('open');
        portfolioBtn.classList.remove('open');
    } else {
        portfolioBtn.disabled = false;
        portfolioBtn.title = '';
    }

    var preenchidos = [verticalArr.length ? '1' : '', portfolioArr.length ? '1' : '', equipeArr.length ? '1' : '', userNames.length ? '1' : ''].filter(Boolean).length;
    var verticalPermiteSozinha = temSaudeOuEducacao;

    if (preenchidos < 2 && !verticalPermiteSozinha) {
        if (!silencioso) {
            _lastSignature = null;
            document.getElementById('results').innerHTML =
                '<div class="state"><div class="state-icon">⚠️</div>' +
                'Selecione pelo menos <strong>2 filtros</strong> antes de buscar.<br>' +
                '<span style="font-size:12px;margin-top:6px;display:block">Portfólio, Vertical, Equipe e/ou Responsável.</span></div>';
            document.getElementById('chips').style.display = 'none';
        } else if (buscaAtiva) { agendarProximoRefresh(); }
        return;
    }

    var params = new URLSearchParams();
    if (verticalArr.length) params.set('vertical', verticalArr.join(','));
    if (portfolioArr.length) params.set('portfolio', portfolioArr.join(','));
    if (equipeArr.length) params.set('cf[21500]', equipeArr.join(','));
    if (userNames.length) params.set('users', userNames.join(','));
    if (mostrarParceiros) params.set('mostrarParceiros', 'true');

    var prestacaoContas = document.getElementById('sel-prestacao-contas').value;
    if (prestacaoContas && prestacaoContas !== 'incluir') {
        params.set('prestacaoContas', prestacaoContas);
    }

    var arrTypeKeys = [];
    tiposSelected.forEach(function (k) { arrTypeKeys.push(k); });
    var totalTiposDisponiveis = document.querySelectorAll('#tipo-items input[type=checkbox]').length;
    var todosSelecionados = arrTypeKeys.length >= totalTiposDisponiveis && totalTiposDisponiveis > 0;

    if (arrTypeKeys.length > 0 && !todosSelecionados) {
        params.set('typeIds', arrTypeKeys.join(','));
    }

    var days = document.getElementById('sel-days').value;
    if (days && days !== '0') params.set('days', days);

    if (!silencioso) {
        params.set('fresh', '1');
        _lastSignature = null;
        knownIssues = {};
        if (pendingSortRestore) {
            pendingSortRestore = false;
        } else {
            sortState.col = null;
            sortState.dir = 'asc';
        }
        document.getElementById('chips').style.display = 'none';
        document.getElementById('results').innerHTML =
            '<div class="state"><div class="spinner"></div>Buscando chamados no Jira...</div>';
        pararPolling();
        limparBanners();
    }

    fetch('/api/chamados?' + params.toString(), { signal: buscarController.signal })
        .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        })
        .then(function (data) {
            if (!data.ok) throw new Error(data.error || 'Erro desconhecido');

            renderResults(data, userNames, { skipIfUnchanged: silencioso });

            if (silencioso) {
                limparBanners();
                try { detectarNovidades(data); } catch (e) { console.warn('[novidades] erro:', e); }
            }

            atualizarKnownIssues(data);
            if (!silencioso) salvarFiltros();

            if (!buscaAtiva) {
                buscaAtiva = true;
                pedirPermissaoNotificacao();
                iniciarPolling();
            } else {
                agendarProximoRefresh();
            }
        })
        .catch(function (err) {
            if (err.name === 'AbortError') {
                if (silencioso && buscaAtiva) {
                    agendarProximoRefresh();
                }
                return;
            }
            if (!silencioso) {
                document.getElementById('results').innerHTML =
                    '<div class="state"><div class="state-icon">⚠️</div><strong>Erro ao buscar:</strong> ' + escHtml(err.message) + '</div>';
            }
            if (buscaAtiva) {
                agendarProximoRefresh();
            } else if (!silencioso) {
                buscaAtiva = true;
                iniciarPolling();
            }
        });
}

document.getElementById('sel-days').addEventListener('change', function () { if (buscaAtiva) buscar(); });
document.getElementById('sel-prestacao-contas').addEventListener('change', function () { buscar(); });

inpUser.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !acList.classList.contains('open')) buscar();
});

var STATUS_CLASSE = {
    'Aguardando Manutencao': 'amarelo',
    'Aguardando Manutenção': 'amarelo',
    'Aguardando aprovacao do solicitante': 'azul',
    'Aguardando aprovação do solicitante': 'azul',
    'Em andamento': 'verde',
    'Nao iniciada': 'cinza',
    'Não iniciada': 'cinza',
    'Aberto': 'roxo',
    'Reaberto': 'vermelho'
};

function statusPill(s) {
    return '<span class="status-pill st-' + (STATUS_CLASSE[s] || 'cinza') + '">' + escHtml(s) + '</span>';
}

function priBadge(p) {
    var map = { 'Highest': '1', 'High': '2', 'Medium': '3', 'Low': '4', 'Lowest': '4', '1': '1', '2': '2', '3': '3', '4': '4', '5': '4' };
    var n = map[String(p)];
    if (!n) return '<span style="color:var(--text-secondary);font-size:11px">—</span>';
    return '<span class="pri-badge pri-' + n + '">P' + n + '</span>';
}

function abrevPortfolio(p) {
    if (!p) return '—';
    return escHtml(p.replace('Portfólio ', ''));
}

function fmtDate(iso) {
    if (!iso) return '--';
    var d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' +
        d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

var sortState = { col: null, dir: 'asc' };
var PRIORITY_ORDER = { 'Highest': 1, 'High': 2, 'Medium': 3, 'Low': 4, 'Lowest': 5 };

function sortIssues(issues, col, dir) {
    return issues.slice().sort(function (a, b) {
        var va = a[col] || '';
        var vb = b[col] || '';
        if (col === 'priority') {
            va = PRIORITY_ORDER[va] || 99;
            vb = PRIORITY_ORDER[vb] || 99;
        }
        var cmp = va < vb ? -1 : va > vb ? 1 : 0;
        return dir === 'asc' ? cmp : -cmp;
    });
}

function renderTable(issues, tableId, showTempoFila) {
    if (!issues.length) return '<div class="state"><div class="state-icon">✅</div>Nenhum chamado no momento.</div>';

    var sorted = sortState.col ? sortIssues(issues, sortState.col, sortState.dir) : issues;

    var headers = showTempoFila
        ? ['Chamado', 'Resumo', 'Portfólio', 'Sistema', 'Equipe', 'Status', 'Prior.', 'Tipo', 'Na fila', 'Atualizado']
        : ['Chamado', 'Resumo', 'Portfólio', 'Sistema', 'Responsável', 'Status', 'Prior.', 'Tipo', 'Atualizado'];

    var sortKeysLocal = showTempoFila
        ? ['key', 'summary', 'portfolio', 'sistema', 'equipe', 'status', 'priority', 'type', 'updated', 'updated']
        : ['key', 'summary', 'portfolio', 'sistema', 'assignee', 'status', 'priority', 'type', 'updated'];

    var ths = headers.map(function (h, idx) {
        var col = sortKeysLocal[idx];
        var cls = 'sortable' + (sortState.col === col ? (' sort-' + sortState.dir) : '');
        return '<th class="' + cls + '" onclick="onSort(\'' + tableId + '\',\'' + col + '\')">' + h + '</th>';
    }).join('');

    var rows = sorted.map(function (i) {
        var safeUrl = (typeof i.url === 'string' && i.url.startsWith('https://')) ? escHtml(i.url) : '#';
        return '<tr>' +
            '<td><a class="key-link" href="' + safeUrl + '" target="_blank" rel="noopener noreferrer">' + escHtml(i.key) + '</a></td>' +
            '<td style="max-width:400px">' + escHtml(i.summary) + '</td>' +
            '<td style="font-size:11px;color:var(--text-secondary);white-space:nowrap">' + abrevPortfolio(i.portfolio) + '</td>' +
            '<td style="font-size:11px;color:var(--text-secondary);white-space:nowrap">' + escHtml(i.sistema || '—') + '</td>' +

            (showTempoFila
                ? '<td style="font-size:12px;white-space:nowrap">' + escHtml(i.equipe || '—') + '</td>'
                : '<td style="font-size:12px;white-space:nowrap">' + escHtml(i.assignee || '—') + '</td>'
            ) +
            '<td>' + statusPill(i.status) + '</td>' +
            '<td>' + priBadge(i.priority) + '</td>' +
            '<td style="font-size:12px;color:var(--text-secondary)">' + escHtml(i.type) + '</td>' +
            (showTempoFila ? '<td>' + tempoFilaBadge(i.updated) + '</td>' : '') +
            '<td style="font-size:11px;color:var(--text-secondary);white-space:nowrap">' + fmtDate(i.updated) + '</td>' +
            '</tr>';
    }).join('');

    return '<div class="table-wrap"><table id="' + tableId + '">' +
        '<thead><tr>' + ths + '</tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>';
}

var _lastData = null;
var _lastUser = null;

function onSort(tableId, col) {
    if (sortState.col === col) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
        sortState.col = col;
        sortState.dir = 'asc';
    }
    if (_lastData) renderResults(_lastData, _lastUser);
}

var _lastSignature = null;

function assinaturaDados(data) {
    var partes = [];
    ['unassigned', 'assigned'].forEach(function (lista) {
        var itens = data[lista] || [];
        partes.push(lista + ':' + itens.length);
        itens.forEach(function (i) {
            partes.push([i.key, i.summary, i.portfolio, i.sistema, i.equipe,
            i.assignee, i.status, i.priority, i.type, i.updated].join('\u0001'));
        });
    });
    partes.push([data.prestacaoContasAtivo, data.truncatedUnassigned, data.truncatedAssigned,
    data.jiraTotalUnassigned, data.jiraTotalAssigned].join('|'));
    return partes.join('\u0002');
}

function renderResults(data, userKey, opts) {
    _lastData = data;
    _lastUser = userKey;

    var assinatura = assinaturaDados(data);
    if (opts && opts.skipIfUnchanged && assinatura === _lastSignature) return false;
    _lastSignature = assinatura;

    var unassigned = data.unassigned || [];
    var assigned = data.assigned || [];
    var userName = selectedUsers.length
        ? selectedUsers.map(function (u) { return u.displayName; }).join(', ')
        : null;

    document.getElementById('chip-total').textContent = unassigned.length + assigned.length;
    document.getElementById('chip-unassigned').textContent = unassigned.length;
    document.getElementById('chip-mine').textContent = assigned.length;
    document.getElementById('chips').style.display = 'flex';

    var avisos = [];
    if (data.truncatedUnassigned)
        avisos.push('sem responsável: carregados ' + data.loadedUnassigned + ' de ' + data.jiraTotalUnassigned);
    if (data.truncatedAssigned)
        avisos.push('atribuídos: carregados ' + data.loadedAssigned + ' de ' + data.jiraTotalAssigned);
    var incompleto = avisos.length
        ? '<div class="incomplete-banner">⚠️ Resultados incompletos — ' + avisos.join(' · ') + '. Refine os filtros ou reduza o período.</div>'
        : '';

    var filtroInfo = data.prestacaoContasAtivo
        ? '<div class="info-banner">ℹ️ Filtro de Prestação de Contas ativo — as contagens refletem apenas os chamados filtrados.</div>'
        : '';

    document.getElementById('results').innerHTML = incompleto + filtroInfo +
        '<div class="section">' +
        '<div class="section-header"><h3>⚠️ Sem responsável</h3><span class="tag tag-warning">' + unassigned.length + ' chamado' + (unassigned.length !== 1 ? 's' : '') + '</span></div>' +
        renderTable(unassigned, 'tbl-unassigned', true) +
        '</div>' +
        '<div class="section">' +
        '<div class="section-header"><h3>👤 Atribuídos' + (userName ? ' a ' + escHtml(userName) : '') + '</h3><span class="tag tag-blue">' + assigned.length + ' chamado' + (assigned.length !== 1 ? 's' : '') + '</span></div>' +
        renderTable(assigned, 'tbl-assigned') +
        '</div>';
    return true;
}

function atualizarKnownIssues(data) {
    knownIssues = {};
    var all = (data.unassigned || []).concat(data.assigned || []);
    all.forEach(function (i) {
        knownIssues[i.key] = { status: i.status, assignee: i.assignee || null, updated: i.updated };
    });
}

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.warn('[SW] Falha ao registrar:', err);
    });
}

function atualizarBadgeNotif() {
    var btn = document.getElementById('notif-btn');
    if (!btn || !('Notification' in window)) return;
    var perm = Notification.permission;
    btn.style.display = 'flex';
    btn.className = 'notif-btn ' + perm;
    if (perm === 'granted') {
        btn.textContent = '🔔 Alertas ativos';
        btn.title = 'Notificações ativas — clique para testar';
    } else if (perm === 'default') {
        btn.textContent = '🔔 Ativar alertas';
        btn.title = 'Clique para ativar notificações';
    } else {
        btn.textContent = '🔕 Alertas bloqueados';
        btn.title = 'Notificações bloqueadas no navegador — clique para ver como resolver';
    }
}

function fecharGuiaNotif() {
    document.getElementById('notif-guide').style.display = 'none';
}

function clicarNotifBtn() {
    var perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    if (perm === 'granted') {
        notificar('🔔 Teste — Chamados por Vertical', 'As notificações estão funcionando!', 'teste');
    } else if (perm === 'default') {
        pedirPermissaoNotificacao();
    } else {
        document.getElementById('notif-guide').style.display = 'flex';
    }
}

function pedirPermissaoNotificacao() {
    if (!('Notification' in window)) return;
    atualizarBadgeNotif();
    if (Notification.permission === 'granted') {
        enviarBoasVindas();
    } else if (Notification.permission === 'default') {
        Notification.requestPermission().then(function (perm) {
            atualizarBadgeNotif();
            if (perm === 'granted') enviarBoasVindas();
        });
    }
}

function enviarBoasVindas() {
    var nomes = selectedUsers.map(function (u) { return u.displayName; });
    var corpo = 'Você será notificado sobre:\n'
        + '• Novos chamados sem responsável\n'
        + (nomes.length ? '• Atualizações nos chamados de ' + nomes.join(', ') : '• Atualizações nos chamados atribuídos');
    notificar('✅ Alertas ativados — Chamados por Vertical', corpo, 'boas-vindas');
}

function notificar(titulo, corpo, tag) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(function (reg) {
            return reg.showNotification(titulo, {
                body: corpo,
                tag: tag,
                renotify: true,
                icon: '/favicon.ico',
            });
        }).catch(function (err) {
            console.warn('[notif] showNotification falhou, usando fallback:', err);
            try { new Notification(titulo, { body: corpo, tag: tag }); } catch (e) { }
        });
    } else {
        try { new Notification(titulo, { body: corpo, tag: tag }); } catch (e) { }
    }
}

atualizarBadgeNotif();

function adicionarUserTag(u) {
    if (selectedUsers.some(function (x) { return x.name === u.name; })) return;
    selectedUsers.push(u);
    renderUserTags();
}

function removerUserTag(name) {
    selectedUsers = selectedUsers.filter(function (u) { return u.name !== name; });
    renderUserTags();
    if (buscaAtiva) buscar();
}

function renderUserTags() {
    var container = document.getElementById('user-tags');
    container.innerHTML = '';
    selectedUsers.forEach(function (u) {
        var tag = document.createElement('span');
        tag.className = 'user-tag';

        var nameSpan = document.createElement('span');
        nameSpan.textContent = u.displayName;

        var x = document.createElement('span');
        x.className = 'tag-x';
        x.title = 'Remover';
        x.textContent = '×';
        x.addEventListener('click', (function (userName) {
            return function () { removerUserTag(userName); };
        })(u.name));

        tag.appendChild(nameSpan);
        tag.appendChild(x);
        container.appendChild(tag);
    });
    document.getElementById('inp-user').placeholder = selectedUsers.length ? 'Adicionar...' : 'Adicionar responsável...';
}

function salvarFiltros() {
    try {
        var arrTypeKeys = [];
        var arrVertical = [];
        multiSelected.vertical.forEach(function (v) { arrVertical.push(v); });
        var arrPortfolio = [];
        multiSelected.portfolio.forEach(function (p) { arrPortfolio.push(p); });
        var arrEquipe = [];
        multiSelected.equipe.forEach(function (e) { arrEquipe.push(e); });

        localStorage.setItem('filtros_v2', JSON.stringify({
            portfolio: arrPortfolio,
            vertical: arrVertical,
            equipe: arrEquipe,
            days: document.getElementById('sel-days').value,
            tipos: arrTypeKeys,
            users: selectedUsers,
            mostrarParceiros: mostrarParceiros,
            prestacaoContas: document.getElementById('sel-prestacao-contas').value,
            sortCol: sortState.col,
            sortDir: sortState.dir,
        }));
    } catch (e) { }
}

function restaurarFiltros() {
    try {
        var saved = localStorage.getItem('filtros_v2');
        if (!saved) return;
        var f = JSON.parse(saved);

        var verticalArr = Array.isArray(f.vertical) ? f.vertical : (f.vertical ? [f.vertical] : []);
        var portfolioArr = Array.isArray(f.portfolio) ? f.portfolio : (f.portfolio ? [f.portfolio] : []);
        var equipeArr = Array.isArray(f.equipe) ? f.equipe : (f.equipe ? [f.equipe] : []);

        if (verticalArr.length) {
            pendingVerticalRestore = verticalArr;
        }
        if (portfolioArr.length) {
            pendingPortfolioRestore = portfolioArr;
        }
        if (equipeArr.length) {
            pendingEquipeRestore = equipeArr;
        }

        if (f.days) document.getElementById('sel-days').value = f.days;
        if (f.prestacaoContas) document.getElementById('sel-prestacao-contas').value = f.prestacaoContas;
        if (f.users && f.users.length) {
            f.users.forEach(function (u) { adicionarUserTag(u); });
        }
        if (f.tipos && f.tipos.length) pendingTiposRestore = f.tipos;
        if (f.mostrarParceiros) {
            mostrarParceiros = true;
            document.getElementById('chk-parceiros').checked = true;
        }
        if (f.sortCol) {
            sortState.col = f.sortCol;
            sortState.dir = f.sortDir || 'asc';
            pendingSortRestore = true;
        }

        var verticalTemSaudeOuEducacao = verticalArr.some(function (v) {
            var vLower = v.toLowerCase();
            return vLower === 'saúde' || vLower === 'educação';
        });

        var preenchidos = [verticalArr.length ? '1' : '', portfolioArr.length ? '1' : '', equipeArr.length ? '1' : '', (f.users && f.users.length) ? '1' : ''].filter(Boolean).length;
        if (preenchidos >= 2 || verticalTemSaudeOuEducacao) pendingAutoSearch = true;
    } catch (e) { }
}

restaurarFiltros();

initMultiSelect('vertical', VERTICAIS_OPCOES);
if (pendingVerticalRestore) {
    aplicarMultiRestore('vertical', pendingVerticalRestore);
    pendingVerticalRestore = null;
}

initMultiSelect('portfolio', PORTFOLIOS_OPCOES);
if (pendingPortfolioRestore) {
    aplicarMultiRestore('portfolio', pendingPortfolioRestore);
    pendingPortfolioRestore = null;
}

initMultiSelect('equipe', EQUIPES_OPCOES);
if (pendingEquipeRestore) {
    aplicarMultiRestore('equipe', pendingEquipeRestore);
    pendingEquipeRestore = null;
}

function atualizarBadgeTitulo(delta) {
    pendingCount = Math.max(0, pendingCount + (delta || 0));
    document.title = pendingCount > 0
        ? '(' + pendingCount + ') Chamados por Vertical — Betha Sistemas'
        : 'Chamados por Vertical — Betha Sistemas';
}

var wakeLock = null;

async function ativarWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { }
}

document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { atualizarTempoFila(); atualizarRotuloRefresh(); }
    if (!document.hidden && buscaAtiva) {
        ativarWakeLock();
        pendingCount = 0;
        document.title = 'Chamados por Vertical — Betha Sistemas';
    }
});

function tempoRelativo(iso) {
    if (!iso) return '';
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'agora';
    if (diff < 3600) return Math.floor(diff / 60) + 'min';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h';
    return Math.floor(diff / 86400) + 'd';
}

function classeTempoFila(iso) {
    var horas = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3600000);
    return horas < 2 ? 'ok' : horas < 8 ? 'avg' : 'bad';
}

function tempoFilaBadge(iso) {
    if (!iso) return '';
    return '<span class="tempo-fila ' + classeTempoFila(iso) + '" data-iso="' + escHtml(iso) + '">há ' + tempoRelativo(iso) + '</span>';
}

function atualizarTempoFila() {
    if (document.hidden) return;
    document.querySelectorAll('.tempo-fila[data-iso]').forEach(function (el) {
        var iso = el.getAttribute('data-iso');
        var texto = 'há ' + tempoRelativo(iso);
        var cls = 'tempo-fila ' + classeTempoFila(iso);
        if (el.textContent !== texto) el.textContent = texto;
        if (el.className !== cls) el.className = cls;
    });
}
setInterval(atualizarTempoFila, 30000);

function iniciarPolling() {
    document.getElementById('refresh-bar').style.display = 'flex';
    ativarWakeLock();
    if (!timerWorker) {
        timerWorker = new Worker('/timer-worker.js');
        timerWorker.onmessage = function (e) {
            if (e.data.type === 'done') {
                if (e.data.gen !== timerGeneration) return;
                document.getElementById('refresh-label').textContent = 'Atualizando...';
                document.getElementById('refresh-dot').classList.remove('pulsing');
                buscar(true);
            }
        };
    }
    if (!refreshLabelTimer) refreshLabelTimer = setInterval(atualizarRotuloRefresh, 1000);
    agendarProximoRefresh();
}

function pararPolling() {
    timerGeneration++;
    refreshDeadline = 0;
    if (timerWorker) { timerWorker.postMessage({ cmd: 'stop' }); }
    var bar = document.getElementById('refresh-bar');
    if (bar) bar.style.display = 'none';
}

function agendarProximoRefresh() {
    document.getElementById('refresh-bar').style.display = 'flex';
    refreshDeadline = Date.now() + REFRESH_INTERVAL * 1000;
    document.getElementById('refresh-dot').classList.add('pulsing');
    document.getElementById('refresh-label').textContent = 'Atualiza em ' + REFRESH_INTERVAL + 's';
    reiniciarBarraRefresh();
    if (timerWorker) {
        timerWorker.postMessage({ cmd: 'start', endAt: refreshDeadline, gen: timerGeneration });
    }
}

function reiniciarBarraRefresh() {
    var bar = document.getElementById('refresh-progress-bar');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    void bar.offsetWidth;
    bar.style.transition = 'width ' + REFRESH_INTERVAL + 's linear';
    bar.style.width = '0%';
}

function segundosRestantes(deadline) {
    return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

function atualizarRotuloRefresh() {
    if (document.hidden || !refreshDeadline) return;
    var s = segundosRestantes(refreshDeadline);
    if (s > 0) document.getElementById('refresh-label').textContent = 'Atualiza em ' + s + 's';
}

function detectarNovidades(data) {
    if (Object.keys(knownIssues).length === 0) return;

    var unassigned = data.unassigned || [];
    var assigned = data.assigned || [];

    var novosUnassigned = unassigned.filter(function (i) {
        var prev = knownIssues[i.key];
        return !prev || prev.assignee !== null;
    });
    var novosUnassignedKeys = new Set(novosUnassigned.map(function (i) { return i.key; }));

    var statusAlterado = assigned.filter(function (i) {
        var prev = knownIssues[i.key];
        return prev && prev.status !== i.status;
    }).map(function (i) {
        return Object.assign({}, i, { prevStatus: knownIssues[i.key].status });
    });
    var statusAlteradoKeys = new Set(statusAlterado.map(function (i) { return i.key; }));

    var all = unassigned.concat(assigned);
    var movimentados = all.filter(function (i) {
        if (novosUnassignedKeys.has(i.key) || statusAlteradoKeys.has(i.key)) return false;
        var prev = knownIssues[i.key];
        return prev && prev.status === i.status && prev.updated !== i.updated;
    });

    var currentKeys = new Set(all.map(function (i) { return i.key; }));
    var resultadosTruncados = data.truncated === true;
    var desaparecidos = resultadosTruncados ? [] : Object.keys(knownIssues).filter(function (key) {
        return !currentKeys.has(key) && knownIssues[key].assignee !== null;
    });

    if (novosUnassigned.length > 0) {
        var tituloU = novosUnassigned.length === 1
            ? '⚠️ Novo chamado sem responsável: ' + novosUnassigned[0].key
            : '⚠️ ' + novosUnassigned.length + ' novos chamados sem responsável';
        var corpoU = novosUnassigned.length === 1
            ? novosUnassigned[0].summary
            : novosUnassigned.map(function (i) { return '• ' + i.key + ' — ' + i.summary.slice(0, 55); }).join('\n');
        notificar(tituloU, corpoU, 'unassigned');
        atualizarBadgeTitulo(novosUnassigned.length);
        var labelU = novosUnassigned.length === 1
            ? '1 novo chamado sem responsável: <strong>' + escHtml(novosUnassigned[0].key) + '</strong> — ' + escHtml(novosUnassigned[0].summary.slice(0, 60))
            : novosUnassigned.length + ' novos chamados sem responsável detectados';
        exibirBanner('🔔 ' + labelU, 'warning');
    }

    if (statusAlterado.length > 0) {
        var tituloS = statusAlterado.length === 1
            ? '🔄 Status alterado: ' + statusAlterado[0].key
            : '🔄 ' + statusAlterado.length + ' chamados com status alterado';
        var corpoS = statusAlterado.length === 1
            ? statusAlterado[0].summary + '\n' + statusAlterado[0].prevStatus + ' → ' + statusAlterado[0].status
            : statusAlterado.map(function (i) { return '• ' + i.key + ': ' + i.prevStatus + ' → ' + i.status; }).join('\n');
        notificar(tituloS, corpoS, 'status');
        atualizarBadgeTitulo(statusAlterado.length);
        var labelS = statusAlterado.length === 1
            ? 'Status alterado em <strong>' + escHtml(statusAlterado[0].key) + '</strong>: ' + escHtml(statusAlterado[0].prevStatus) + ' → ' + escHtml(statusAlterado[0].status)
            : statusAlterado.length + ' chamados com status alterado';
        exibirBanner('🔄 ' + labelS, 'info');
    }

    if (movimentados.length > 0) {
        var tituloM = movimentados.length === 1
            ? '📋 Movimentação: ' + movimentados[0].key
            : '📋 ' + movimentados.length + ' chamados com movimentação recente';
        var corpoM = movimentados.length === 1
            ? movimentados[0].summary
            : movimentados.map(function (i) { return '• ' + i.key + ' — ' + i.summary.slice(0, 55); }).join('\n');
        notificar(tituloM, corpoM, 'movimentacao');
        atualizarBadgeTitulo(movimentados.length);
        var labelM = movimentados.length === 1
            ? 'Movimentação em <strong>' + escHtml(movimentados[0].key) + '</strong> — ' + escHtml(movimentados[0].summary.slice(0, 60))
            : movimentados.length + ' chamados com movimentação recente';
        exibirBanner('📋 ' + labelM, 'info');
    }

    if (desaparecidos.length > 0) {
        fetch('/api/issues?keys=' + desaparecidos.join(','))
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                if (!data.ok) return;
                var encerrados = data.issues.filter(function (i) { return i.statusCat === 'done'; });
                if (!encerrados.length) return;
                var tituloR = encerrados.length === 1
                    ? '✅ Chamado encerrado: ' + encerrados[0].key
                    : '✅ ' + encerrados.length + ' chamados encerrados';
                var corpoR = encerrados.length === 1
                    ? 'Status: ' + encerrados[0].status
                    : encerrados.map(function (i) { return '• ' + i.key + ' — ' + i.status; }).join('\n');
                notificar(tituloR, corpoR, 'resolvidos');
                var labelR = encerrados.length === 1
                    ? 'Chamado <strong>' + escHtml(encerrados[0].key) + '</strong> encerrado — ' + escHtml(encerrados[0].status)
                    : encerrados.length + ' chamados encerrados';
                exibirBanner('✅ ' + labelR, 'success');
            })
            .catch(function () { });
    }
}

function limparBanners() {
    document.querySelectorAll('.new-issues-banner').forEach(function (el) { el.remove(); });
}

var BANNER_STYLES = {
    warning: { bg: 'var(--orange-light)', border: 'var(--orange)', color: 'var(--orange-dark)', btn: 'var(--orange)' },
    info: { bg: 'var(--blue-light)', border: 'var(--blue-mid)', color: 'var(--blue-text)', btn: '#1565C0' },
    success: { bg: 'var(--green-light)', border: 'var(--green)', color: 'var(--green)', btn: '#2E7D32' },
};

function exibirBanner(html, tipo) {
    var s = BANNER_STYLES[tipo] || BANNER_STYLES.info;
    var banner = document.createElement('div');
    banner.className = 'new-issues-banner';
    banner.style.background = s.bg;
    banner.style.borderColor = s.border;
    banner.style.color = s.color;
    banner.innerHTML = html +
        ' <button onclick="buscar()" style="margin-left:auto;background:' + s.btn + ';color:#fff;border:none;border-radius:6px;padding:4px 12px;font-size:12px;cursor:pointer;font-weight:700">Ver atualização</button>';
    document.getElementById('results').insertAdjacentElement('beforebegin', banner);
}