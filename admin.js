/* ---------------------------------------------------------------------
   Client Discovery Workspace
   Staff-only dashboard for reviewing, editing and managing submissions.
   Database authorization remains the source of truth.
   --------------------------------------------------------------------- */
(function () {
  'use strict';

  var Q = window.Q;
  var h = Q.h;
  var cfg = window.APP_CONFIG || {};
  var app = document.getElementById('app');

  var configured =
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !/YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);

  if (!configured || !window.supabase) {
    app.appendChild(h('div', { class: 'wrap admin' },
      h('div', { class: 'banner' }, 'Supabase is not connected yet. Open config.js and add the Project URL and anon / publishable key from your Supabase project.'),
      h('p', { class: 'hint' }, 'Use the anon / publishable key only. Never put the service_role / secret key in this site.'),
      h('p', null, h('a', { href: 'index.html' }, 'Back to Client Discovery Portal'))));
    return;
  }

  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var BUCKET = Q.BUCKET;
  var STATUSES = [
    ['new', 'New'],
    ['in_review', 'In review'],
    ['in_progress', 'In progress'],
    ['completed', 'Completed'],
    ['archived', 'Archived']
  ];
  var STATUS_TRANSITIONS = {
    new: ['in_review', 'archived'],
    in_review: ['in_progress', 'archived'],
    in_progress: ['completed', 'archived'],
    completed: ['archived'],
    archived: []
  };

  var statusLabel = function (v) {
    for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i][0] === v) return STATUSES[i][1];
    return v;
  };

  function allowedStatusOptions(current) {
    var options = [current].concat(STATUS_TRANSITIONS[current] || []);
    return options.filter(function (value, index) {
      return options.indexOf(value) === index;
    });
  }

  var userEmail = '';
  var rows = [];
  var filter = { q: '', status: 'all' };
  var activeTab = 'overview';
  var navigationReady = false;
  var STAFF_UNLOCK_KEY = 'client_discovery_staff_unlocked';

  function isStaffUnlocked() {
    try { return sessionStorage.getItem(STAFF_UNLOCK_KEY) === '1'; }
    catch (e) { return false; }
  }

  function setStaffUnlocked(value) {
    try {
      if (value) sessionStorage.setItem(STAFF_UNLOCK_KEY, '1');
      else sessionStorage.removeItem(STAFF_UNLOCK_KEY);
    } catch (e) {}
  }

  function replaceHistory(view, data) {
    var state = Object.assign({ app: 'client-discovery', view: view }, data || {});
    window.history.replaceState(state, '', 'admin.html');
  }

  function pushHistory(view, data) {
    var state = Object.assign({ app: 'client-discovery', view: view }, data || {});
    window.history.pushState(state, '', 'admin.html');
  }

  function handlePopState(e) {
    var state = e.state;
    if (!state || state.app !== 'client-discovery') return;
    if (!isStaffUnlocked()) {
      replaceHistory('login');
      showLogin();
      return;
    }
    if (state.view === 'list') showList(false);
    else if (state.view === 'detail') showDetail(state.id, state.tab || 'overview', false);
    else if (state.view === 'edit') {
      if (state.id) {
        sb.from('submissions').select('*').eq('id', state.id).single().then(function (res) {
          if (res.error || !res.data) { showList(false); return; }
          showEdit(res.data, false);
        });
      } else showEdit(null, false);
    }
  }

  /* ------------------------------ utilities ------------------------------ */

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
    catch (e) { return iso; }
  }

  function fmtShortDate(iso) {
    try { return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch (e) { return iso; }
  }

  function toast(msg) {
    var t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  function mount(node) {
    app.textContent = '';
    app.appendChild(node);
    window.scrollTo(0, 0);
  }

  function shell(content) {
    return h('div', { class: 'wrap admin' },
      h('header', { class: 'workspace-topbar' },
        h('a', { class: 'workspace-brand', href: 'admin.html', 'aria-label': 'Client Discovery Workspace home' },
          h('span', { class: 'brand-mark' }, 'CD'),
          h('span', null,
            h('strong', null, 'Client Discovery'),
            h('small', null, 'Workspace'))),
        h('div', { class: 'topbar-right' },
          userEmail ? h('span', { class: 'staff-email' }, userEmail) : null,
          userEmail ? h('button', { class: 'btn ghost small', type: 'button', onClick: signOut }, 'Sign out') : null)) ,
      content);
  }

  function errorView(msg) {
    return shell(h('div', { class: 'workspace-error' },
      h('div', { class: 'error-icon', 'aria-hidden': 'true' }, '!'),
      h('h1', { class: 'page-title' }, 'Something went wrong'),
      h('p', { class: 'hint' }, msg),
      h('button', { class: 'btn ghost', type: 'button', onClick: function () { showList(false); } }, 'Back to workspace')));
  }

  function downloadText(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function csvCell(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function buildCsv(list) {
    var head = ['Submitted', 'Status', 'Added by', 'Company']
      .concat(Q.ALL_FIELDS.map(function (f) { return f.label; }))
      .concat(['Declaration name', 'Declaration position', 'Declaration company', 'Declaration date', 'Signed', 'Staff notes']);
    var body = list.map(function (r) {
      var a = r.answers || {};
      return [fmtDate(r.created_at), statusLabel(r.status), r.source, r.company_name || '']
        .concat(Q.ALL_FIELDS.map(function (f) {
          if (f.type === 'file') {
            return (r.files || []).filter(function (x) { return x.field === f.id; })
              .map(function (x) { return x.name; }).join('; ');
          }
          return Q.answerText(f, a);
        }))
        .concat([a.decl_name || '', a.decl_position || '', a.decl_company || '', a.decl_date || '',
          Q.validSignature(a.signature) ? 'Yes' : 'No', r.staff_notes || '']);
    });
    return '\uFEFF' + [head].concat(body).map(function (row) { return row.map(csvCell).join(','); }).join('\r\n');
  }

  function statusPill(status) {
    return h('span', { class: 'pill ' + status }, statusLabel(status));
  }

  function statCard(label, value, status, active) {
    return h('button', {
      class: 'stat-card' + (active ? ' active' : ''),
      type: 'button',
      onClick: function () {
        filter.status = status;
        renderList();
      }
    },
      h('span', { class: 'stat-label' }, label),
      h('strong', { class: 'stat-value' }, String(value)));
  }

  function keyValue(label, value, emptyLabel) {
    return h('div', { class: 'info-item' },
      h('span', { class: 'info-label' }, label),
      h('span', { class: 'info-value' + (value ? '' : ' muted') }, value || emptyLabel || 'Not provided'));
  }

  function answerValue(id, answers) {
    var f = null;
    for (var i = 0; i < Q.ALL_FIELDS.length; i++) if (Q.ALL_FIELDS[i].id === id) { f = Q.ALL_FIELDS[i]; break; }
    if (!f) return '';
    return Q.answerText(f, answers || {});
  }

  /* ------------------------------- sign in ------------------------------- */

  function showLogin(message) {
    var email = h('input', { id: 'email', type: 'email', autocomplete: 'username' });
    var pass = h('input', { id: 'password', type: 'password', autocomplete: 'current-password' });
    var err = h('div', { class: 'err-msg', role: 'alert', hidden: !message }, message || '');
    var btn = h('button', { class: 'btn', type: 'button' }, 'Sign in');

    async function go() {
      err.hidden = true;
      btn.disabled = true;
      btn.textContent = 'Signing in...';
      var res = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
      if (res.error) {
        err.textContent = 'That email or password is not right.';
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = 'Sign in';
        return;
      }
      userEmail = res.data && res.data.user ? res.data.user.email : email.value.trim();
      setStaffUnlocked(true);
      enter(true);
    }
    btn.addEventListener('click', go);
    pass.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    email.addEventListener('keydown', function (e) { if (e.key === 'Enter') pass.focus(); });

    mount(h('div', { class: 'wrap center' },
      h('div', { class: 'loginbox workspace-login' },
        h('div', { class: 'login-mark' }, 'CD'),
        h('p', { class: 'eyebrow' }, 'STAFF WORKSPACE'),
        h('h1', { style: 'font-size:30px' }, 'Sign in'),
        h('p', { class: 'hint' }, 'Access client discovery submissions and project information.'),
        h('label', { class: 'lbl', for: 'email' }, 'Email'), email,
        h('label', { class: 'lbl', for: 'password' }, 'Password'), pass,
        err,
        btn)));
    email.focus();
  }

  async function signOut() {
    setStaffUnlocked(false);
    await sb.auth.signOut();
    userEmail = '';
    rows = [];
    replaceHistory('login');
    showLogin();
  }

  async function enter(fromLogin) {
    var res = await sb.rpc('is_staff');
    if (res.error || !res.data) {
      setStaffUnlocked(false);
      await sb.auth.signOut();
      userEmail = '';
      replaceHistory('login');
      showLogin('This account does not have staff access.');
      return;
    }
    if (fromLogin) replaceHistory('list');
    showList(false);
  }

  async function init() {
    window.addEventListener('popstate', handlePopState);
    window.addEventListener('pagehide', function () {
      // Leaving the staff page clears the in-tab unlock. Supabase may keep
      // its session, but returning through Staff access still requires login.
      setStaffUnlocked(false);
    });

    var res = await sb.auth.getSession();
    var session = res.data && res.data.session;
    if (session && isStaffUnlocked()) {
      userEmail = session.user.email || '';
      enter(false);
    } else {
      if (session && !isStaffUnlocked()) await sb.auth.signOut();
      replaceHistory('login');
      showLogin();
    }
  }

  /* -------------------------------- list -------------------------------- */

  async function showList(navigate) {
    if (navigate === undefined) navigate = true;
    if (navigate && navigationReady) pushHistory('list');
    navigationReady = true;
    mount(shell(h('div', { class: 'loading-state' },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('span', null, 'Loading workspace...'))));
    var res = await sb.from('submissions')
      .select('id,created_at,updated_at,status,source,company_name,contact_name,files')
      .order('created_at', { ascending: false });
    if (res.error) {
      console.error(res.error);
      mount(errorView('Could not load submissions. Check your connection and try again.'));
      return;
    }
    rows = res.data || [];
    renderList();
  }

  function renderList() {
    var box = h('div', { class: 'submission-list' });
    var count = h('span', { class: 'result-count' });

    var shown = function () {
      var q = filter.q.trim().toLowerCase();
      return rows.filter(function (r) {
        var okStatus = filter.status === 'all' || r.status === filter.status;
        var hay = ((r.company_name || '') + ' ' + (r.contact_name || '')).toLowerCase();
        return okStatus && (!q || hay.indexOf(q) !== -1);
      });
    };

    function draw() {
      var list = shown();
      count.textContent = list.length + ' of ' + rows.length + ' submissions';
      box.textContent = '';

      if (!rows.length) {
        box.appendChild(h('div', { class: 'empty-state' },
          h('div', { class: 'empty-icon', 'aria-hidden': 'true' }, '✓'),
          h('strong', null, 'No client submissions yet'),
          h('p', null, 'New discovery submissions will appear here. You can also create a staff entry when needed.'),
          h('button', { class: 'btn small', type: 'button', onClick: function () { showEdit(null); } }, 'Create first entry')));
        return;
      }

      if (!list.length) {
        box.appendChild(h('div', { class: 'empty-filter' },
          h('strong', null, 'No matches'),
          h('span', { class: 'hint' }, 'Try a different company, contact or status.')));
        return;
      }

      list.forEach(function (r) {
        var nFiles = (r.files || []).length;
        box.appendChild(h('button', { class: 'submission-row', type: 'button', onClick: function () { showDetail(r.id); } },
          h('span', { class: 'submission-client' },
            h('strong', null, r.company_name || 'Untitled company'),
            h('span', { class: 'row-contact' }, r.contact_name || 'No contact name')),
          h('span', { class: 'submission-status' }, statusPill(r.status)),
          h('span', { class: 'submission-source' }, r.source === 'staff' ? 'Staff added' : 'Client'),
          h('span', { class: 'submission-files' }, nFiles + (nFiles === 1 ? ' file' : ' files')),
          h('span', { class: 'submission-date' }, fmtShortDate(r.created_at)),
          h('span', { class: 'row-arrow', 'aria-hidden': 'true' }, '›')));
      });
    }

    var search = h('input', {
      type: 'text',
      placeholder: 'Search company or contact',
      'aria-label': 'Search submissions',
      value: filter.q,
      onInput: function (e) { filter.q = e.target.value; draw(); }
    });
    var statusSel = h('select', {
      'aria-label': 'Filter by status',
      onChange: function (e) { filter.status = e.target.value; renderList(); }
    }, h('option', { value: 'all' }, 'All statuses'),
      STATUSES.map(function (s) { return h('option', { value: s[0], selected: filter.status === s[0] }, s[1]); }));

    var exportBtn = h('button', { class: 'btn ghost', type: 'button' }, 'Export CSV');
    exportBtn.addEventListener('click', async function () {
      exportBtn.disabled = true;
      var res = await sb.from('submissions').select('*').order('created_at', { ascending: false });
      exportBtn.disabled = false;
      if (res.error) { toast('Could not export'); return; }
      downloadText('client-discovery-submissions.csv', buildCsv(res.data || []), 'text/csv');
    });

    var counts = { new: 0, in_review: 0, in_progress: 0, completed: 0, archived: 0 };
    rows.forEach(function (r) { if (counts[r.status] != null) counts[r.status] += 1; });

    mount(shell(h('main', { class: 'workspace-main' },
      h('div', { class: 'workspace-heading' },
        h('div', null,
          h('p', { class: 'eyebrow' }, 'CLIENT DISCOVERY'),
          h('h1', { class: 'page-title' }, 'Project submissions'),
          h('p', { class: 'page-subtitle' }, 'Review client discovery information and keep each project organised.')),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onClick: function () { showEdit(null); } }, '+ New entry'),
          exportBtn,
          h('button', { class: 'btn ghost', type: 'button', onClick: function () { showList(false); } }, 'Refresh'))),
      h('div', { class: 'stats-grid' },
        statCard('All', rows.length, 'all', filter.status === 'all'),
        statCard('New', counts.new, 'new', filter.status === 'new'),
        statCard('In review', counts.in_review, 'in_review', filter.status === 'in_review'),
        statCard('In progress', counts.in_progress, 'in_progress', filter.status === 'in_progress'),
        statCard('Completed', counts.completed, 'completed', filter.status === 'completed')),
      h('div', { class: 'list-panel' },
        h('div', { class: 'list-toolbar' },
          h('div', { class: 'search-wrap' }, h('span', { class: 'search-icon', 'aria-hidden': 'true' }, '⌕'), search),
          statusSel,
          count),
        h('div', { class: 'list-header', 'aria-hidden': 'true' },
          h('span', null, 'CLIENT'),
          h('span', null, 'STATUS'),
          h('span', null, 'SOURCE'),
          h('span', null, 'FILES'),
          h('span', null, 'DATE'),
          h('span', null, '')),
        box))));
    draw();
  }

  /* ------------------------------- detail ------------------------------- */

  async function signedUrls(files) {
    var paths = (files || []).map(function (f) { return f.path; });
    var map = {};
    if (!paths.length) return map;
    var res = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
    (res.data || []).forEach(function (d) {
      var url = d.signedUrl || d.signedURL;
      if (url && d.path) map[d.path] = url;
    });
    return map;
  }

  async function downloadFile(f) {
    var res = await sb.storage.from(BUCKET).createSignedUrl(f.path, 120, { download: f.name });
    if (res.error || !res.data) { toast('Could not download this file'); return; }
    var a = document.createElement('a');
    a.href = res.data.signedUrl;
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }


  function money(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n.toLocaleString('en-ZA', { style: 'currency', currency: 'ZAR' }) : 'R0.00';
  }

  function escapeHtml(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c];
    });
  }

  function normalizeDate(value) {
    if (!value) return '';
    var s = String(value).trim();
    var m = s.match(/\b(20\d{2})[-\/.](\d{1,2})[-\/.](\d{1,2})\b/);
    if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
    m = s.match(/\b(\d{1,2})[-\/.](\d{1,2})[-\/.](20\d{2})\b/);
    if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    return '';
  }

  function extractPaymentFields(text) {
    var t = String(text || '').replace(/\u00a0/g, ' ');
    var out = { amount: '', payment_date: '', reference: '', payer_name: '', bank_name: '', description: '' };
    var amountPatterns = [
      /(?:amount|total|payment amount|transaction amount|paid)\s*[:\-]?\s*(?:zar|r)?\s*([0-9][0-9\s,]*\.?[0-9]{0,2})/i,
      /(?:zar|r)\s*([0-9][0-9\s,]*\.?[0-9]{2})/i
    ];
    for (var i = 0; i < amountPatterns.length; i++) {
      var am = t.match(amountPatterns[i]);
      if (am) { out.amount = am[1].replace(/\s/g, '').replace(/,/g, ''); break; }
    }
    var datePatterns = [
      /(?:payment date|transaction date|date)\s*[:\-]?\s*([^\n\r]+)/i,
      /\b(\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2})\b/,
      /\b(\d{1,2}[-\/.]\d{1,2}[-\/.]20\d{2})\b/
    ];
    for (i = 0; i < datePatterns.length; i++) {
      var dm = t.match(datePatterns[i]);
      if (dm) { out.payment_date = normalizeDate(dm[1]); if (out.payment_date) break; }
    }
    var ref = t.match(/(?:reference|transaction reference|payment reference|ref(?:erence)? no\.?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-\/_ .]{2,40})/i);
    if (ref) out.reference = ref[1].trim().replace(/\s{2,}/g, ' ');
    var payer = t.match(/(?:from|payer|account holder|sender|debtor)\s*[:\-]?\s*([^\n\r]{2,80})/i);
    if (payer) out.payer_name = payer[1].trim();
    var banks = ['FNB','FIRST NATIONAL BANK','ABSA','STANDARD BANK','CAPITEC','NEDBANK','TYMEBANK','DISCOVERY BANK','INVESTEC','AFRICAN BANK'];
    for (i = 0; i < banks.length; i++) if (new RegExp('\\b' + banks[i].replace(/ /g, '\\s+') + '\\b', 'i').test(t)) { out.bank_name = banks[i]; break; }
    var desc = t.match(/(?:description|payment description|reason)\s*[:\-]?\s*([^\n\r]{2,120})/i);
    if (desc) out.description = desc[1].trim();
    return out;
  }

  async function extractPdfText(file, progress) {
    if (!window.pdfjsLib) throw new Error('PDF extractor is unavailable');
    var buf = await file.arrayBuffer();
    var pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
    var chunks = [];
    var pages = Math.min(pdf.numPages, 8);
    for (var i = 1; i <= pages; i++) {
      if (progress) progress('Reading PDF page ' + i + ' of ' + pages + '...');
      var page = await pdf.getPage(i);
      var content = await page.getTextContent();
      chunks.push(content.items.map(function (x) { return x.str; }).join(' '));
    }
    return chunks.join('\n');
  }

  async function extractImageText(file, progress) {
    if (!window.Tesseract) throw new Error('OCR engine is unavailable');
    if (progress) progress('Reading proof with OCR...');
    var result = await window.Tesseract.recognize(file, 'eng', {
      logger: function (m) {
        if (progress && m.status === 'recognizing text' && m.progress) progress('OCR ' + Math.round(m.progress * 100) + '%...');
      }
    });
    return result.data && result.data.text ? result.data.text : '';
  }

  async function extractProof(file, progress) {
    var type = file.type || '';
    var text = '';
    var source = 'manual';
    if (type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      text = await extractPdfText(file, progress);
      source = 'pdf_text';
    } else if (/^image\//i.test(type)) {
      text = await extractImageText(file, progress);
      source = 'ocr';
    }
    return { text: text, fields: extractPaymentFields(text), source: source };
  }

  async function uploadPaymentProof(submissionId, file) {
    var safe = file.name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120);
    var path = 'payments/' + submissionId + '/' + Q.uuid() + '-' + safe;
    var up = await sb.storage.from(BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (up.error) throw up.error;
    return { path: path, name: file.name, type: file.type || 'application/octet-stream', size: file.size };
  }

  async function loadPayments(submissionId) {
    var r = await sb.from('payments').select('*').eq('submission_id', submissionId).order('payment_date', { ascending: false });
    if (r.error) throw r.error;
    return r.data || [];
  }

  function receiptHtml(rec, payment) {
    var company = rec.company_name || 'Client';
    var contact = rec.contact_name || '';
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + escapeHtml(payment.receipt_number) + '</title>' +
      '<style>body{font-family:Arial,sans-serif;color:#17232d;padding:42px;max-width:760px;margin:auto}h1{margin:0 0 4px;font-size:30px}p{margin:6px 0;color:#5d6b75}.head{display:flex;justify-content:space-between;gap:30px;border-bottom:1px solid #dce3e7;padding-bottom:22px;margin-bottom:26px}.meta{text-align:right}.box{border:1px solid #dce3e7;border-radius:10px;padding:20px;margin:18px 0}.row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #edf1f3}.row:last-child{border:0}.total{font-size:22px;font-weight:700}.small{font-size:12px;color:#71808a;margin-top:28px}</style></head><body>' +
      '<div class="head"><div><h1>Receipt</h1><p>' + escapeHtml(company) + '</p><p>' + escapeHtml(contact) + '</p></div><div class="meta"><strong>' + escapeHtml(payment.receipt_number) + '</strong><p>' + escapeHtml(payment.payment_date || '') + '</p></div></div>' +
      '<div class="box"><div class="row"><span>Amount received</span><strong class="total">' + escapeHtml(money(payment.amount)) + '</strong></div>' +
      '<div class="row"><span>Payment method</span><span>' + escapeHtml(payment.bank_name || 'Electronic payment') + '</span></div>' +
      '<div class="row"><span>Reference</span><span>' + escapeHtml(payment.reference || 'Not provided') + '</span></div>' +
      '<div class="row"><span>Payer</span><span>' + escapeHtml(payment.payer_name || company) + '</span></div>' +
      '<div class="row"><span>Description</span><span>' + escapeHtml(payment.description || 'Payment received') + '</span></div></div>' +
      '<p>Payment received and recorded for the client above.</p><p class="small">Receipt generated from the Client Discovery Workspace. Keep this receipt together with the supporting proof of payment.</p></body></html>';
  }

  function generateReceiptPdf(rec, payment) {
    if (!window.jspdf || !window.jspdf.jsPDF) { toast('Receipt PDF engine is unavailable'); return null; }
    var doc = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    var x = 48, y = 58;
    doc.setFontSize(26); doc.text('Receipt', x, y);
    doc.setFontSize(10); doc.setTextColor(95, 107, 117); doc.text(payment.receipt_number, 547, y, { align: 'right' });
    y += 24; doc.text(rec.company_name || 'Client', x, y); if (rec.contact_name) { y += 15; doc.text(rec.contact_name, x, y); }
    y += 34; doc.setTextColor(35, 48, 58); doc.setDrawColor(220, 227, 231); doc.line(x, y, 547, y); y += 32;
    var rows = [
      ['Amount received', money(payment.amount)],
      ['Payment date', payment.payment_date || ''],
      ['Reference', payment.reference || 'Not provided'],
      ['Payer', payment.payer_name || rec.company_name || ''],
      ['Bank', payment.bank_name || 'Electronic payment'],
      ['Description', payment.description || 'Payment received']
    ];
    rows.forEach(function (r) { doc.setFontSize(10); doc.setTextColor(95,107,117); doc.text(r[0], x, y); doc.setTextColor(23,35,45); doc.text(String(r[1]), 547, y, { align: 'right' }); y += 26; doc.setDrawColor(238,242,244); doc.line(x, y - 12, 547, y - 12); });
    y += 18; doc.setFontSize(9); doc.setTextColor(110,120,128); doc.text('Payment received and recorded for the client above.', x, y); y += 14; doc.text('Keep this receipt together with the supporting proof of payment.', x, y);
    doc.save(payment.receipt_number + '.pdf');
    return payment.receipt_number;
  }

  function paymentPanel(rec) {
    var wrap = h('div', { class: 'payment-workspace' });
    var fileInput = h('input', { type: 'file', accept: 'application/pdf,image/png,image/jpeg,image/webp', hidden: true });
    var uploadBtn = h('button', { class: 'btn', type: 'button' }, 'Upload proof of payment');
    var status = h('span', { class: 'hint payment-status' }, 'PDF or image. Details will be extracted where possible.');
    uploadBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', async function () {
      var file = fileInput.files && fileInput.files[0]; if (!file) return;
      if (file.size > 25 * 1024 * 1024) { toast('Proof is larger than 25 MB'); return; }
      uploadBtn.disabled = true;
      try {
        status.textContent = 'Reading proof...';
        var extracted = await extractProof(file, function (m) { status.textContent = m; });
        openPaymentReview(rec, file, extracted, function () { renderPaymentTab(rec); });
      } catch (e) {
        console.error(e); toast('Could not read the proof. You can enter the payment manually.');
        openPaymentReview(rec, file, { text: '', fields: {}, source: 'manual' }, function () { renderPaymentTab(rec); });
      } finally { uploadBtn.disabled = false; fileInput.value = ''; status.textContent = 'PDF or image. Details will be extracted where possible.'; }
    });
    var list = h('div', { class: 'payment-list' });
    async function load() {
      try {
        var payments = await loadPayments(rec.id);
        list.textContent = '';
        if (!payments.length) list.appendChild(h('div', { class: 'empty-state compact' }, h('div', { class: 'empty-icon' }, 'R'), h('strong', null, 'No payments recorded yet'), h('p', null, 'Upload a proof of payment and we will pre-fill the payment record.')));
        payments.forEach(function (p) { list.appendChild(paymentCard(rec, p)); });
      } catch (e) { console.error(e); list.appendChild(h('div', { class: 'workspace-error' }, h('p', null, 'Could not load payments. Run the payment migration in Supabase first.'))); }
    }
    function renderPaymentTab(r) { paymentPanelRefresh = true; renderDetail(r, {}); }
    var paymentPanelRefresh = false;
    wrap.appendChild(h('div', { class: 'panel-toolbar' }, h('div', null, h('h2', null, 'Payments'), h('p', { class: 'hint' }, 'Store payment records and the supporting proof.')), h('div', { class: 'actions' }, uploadBtn, fileInput)));
    wrap.appendChild(status); wrap.appendChild(list); load();
    return wrap;
  }

  function paymentCard(rec, p) {
    var proof = h('button', { class: 'btn ghost small', type: 'button' }, 'View proof');
    proof.addEventListener('click', async function () {
      var r = await sb.storage.from(BUCKET).createSignedUrl(p.proof_path, 300, { download: p.proof_name });
      if (r.error || !r.data) { toast('Could not open proof'); return; }
      window.open(r.data.signedUrl, '_blank', 'noopener');
    });
    var pdf = h('button', { class: 'btn ghost small', type: 'button' }, 'Receipt PDF');
    pdf.addEventListener('click', function () { generateReceiptPdf(rec, p); });
    var mail = h('button', { class: 'btn ghost small', type: 'button' }, 'Email receipt');
    mail.addEventListener('click', function () {
      var email = (rec.answers || {}).email || (rec.answers || {}).contact_email || '';
      var subject = encodeURIComponent('Payment receipt ' + p.receipt_number + ' - ' + (rec.company_name || 'Client'));
      var body = encodeURIComponent('Please find your payment receipt reference ' + p.receipt_number + '. The receipt PDF can be attached to this email.\n\nAmount received: ' + money(p.amount) + '\nPayment date: ' + p.payment_date + '\nReference: ' + (p.reference || 'Not provided'));
      window.location.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + subject + '&body=' + body;
    });
    return h('article', { class: 'payment-card' },
      h('div', { class: 'payment-main' }, h('div', null, h('strong', null, money(p.amount)), h('span', { class: 'payment-date' }, p.payment_date || '')), h('span', { class: 'payment-ref' }, p.reference || 'No reference')),
      h('div', { class: 'payment-meta' }, h('span', null, p.receipt_number), h('span', null, p.payer_name || 'Payer not provided'), h('span', null, p.bank_name || 'Electronic payment')),
      h('div', { class: 'payment-actions' }, proof, pdf, mail));
  }

  function openPaymentReview(rec, file, extracted, onSaved) {
    var f = extracted.fields || {};
    var amount = h('input', { type: 'number', min: '0', step: '0.01', value: f.amount || '' });
    var date = h('input', { type: 'date', value: f.payment_date || Q.today() });
    var reference = h('input', { type: 'text', value: f.reference || '', placeholder: 'Bank reference' });
    var payer = h('input', { type: 'text', value: f.payer_name || '', placeholder: 'Payer / account holder' });
    var bank = h('input', { type: 'text', value: f.bank_name || '', placeholder: 'Bank' });
    var description = h('input', { type: 'text', value: f.description || '', placeholder: 'What the payment is for' });
    var err = h('p', { class: 'err-msg', hidden: true });
    var save = h('button', { class: 'btn', type: 'button' }, 'Confirm & save payment');
    var cancel = h('button', { class: 'btn ghost', type: 'button', onClick: onSaved }, 'Cancel');
    save.addEventListener('click', async function () {
      var n = Number(amount.value);
      if (!Number.isFinite(n) || n <= 0) { err.textContent = 'Enter a valid payment amount.'; err.hidden = false; return; }
      if (!date.value) { err.textContent = 'Payment date is required.'; err.hidden = false; return; }
      save.disabled = true; cancel.disabled = true; err.hidden = true;
      try {
        var uploaded = await uploadPaymentProof(rec.id, file);
        var r = await sb.from('payments').insert({
          submission_id: rec.id, amount: n, currency: 'ZAR', payment_date: date.value,
          reference: reference.value.trim() || null, payer_name: payer.value.trim() || null,
          bank_name: bank.value.trim() || null, description: description.value.trim() || null,
          proof_path: uploaded.path, proof_name: uploaded.name,
          extracted_data: { source: extracted.source, fields: f }, extraction_source: extracted.source,
          created_by: (await sb.auth.getUser()).data.user ? (await sb.auth.getUser()).data.user.id : null
        }).select().single();
        if (r.error) throw r.error;
        toast('Payment recorded'); onSaved();
      } catch (e) { console.error(e); err.textContent = 'Could not save the payment. Make sure the payments migration has been run.'; err.hidden = false; save.disabled = false; cancel.disabled = false; }
    });
    mount(shell(h('main', { class: 'workspace-main' },
      h('div', { class: 'edit-head' }, h('button', { class: 'back-link', type: 'button', onClick: onSaved }, '‹ Back'), h('p', { class: 'eyebrow' }, 'PAYMENT REVIEW'), h('h1', { class: 'page-title' }, 'Confirm payment details'), h('p', { class: 'page-subtitle' }, 'The system extracted these values from the proof. Review them before anything is recorded.')),
      h('div', { class: 'payment-review-card' },
        h('div', { class: 'extraction-badge' }, extracted.source === 'ocr' ? 'OCR extracted' : extracted.source === 'pdf_text' ? 'PDF text extracted' : 'Manual entry'),
        h('div', { class: 'info-grid' }, keyValue('Client', rec.company_name), keyValue('Proof', file.name)),
        h('div', { class: 'payment-form-grid' }, h('label', { class: 'lbl' }, 'Amount (ZAR)', amount), h('label', { class: 'lbl' }, 'Payment date', date), h('label', { class: 'lbl' }, 'Reference', reference), h('label', { class: 'lbl' }, 'Payer', payer), h('label', { class: 'lbl' }, 'Bank', bank), h('label', { class: 'lbl' }, 'Description', description)), err,
        h('div', { class: 'edit-actions' }, save, cancel)))));
  }

  async function showDetail(id, tab, navigate) {
    activeTab = tab || 'overview';
    if (navigate === undefined) navigate = true;
    if (navigate && navigationReady) pushHistory('detail', { id: id, tab: activeTab });
    navigationReady = true;
    mount(shell(h('div', { class: 'loading-state' },
      h('span', { class: 'spinner', 'aria-hidden': 'true' }),
      h('span', null, 'Opening client workspace...'))));
    var res = await sb.from('submissions').select('*').eq('id', id).single();
    if (res.error || !res.data) { console.error(res.error); mount(errorView('Could not open this submission.')); return; }
    var rec = res.data;
    var urls = await signedUrls(rec.files);
    renderDetail(rec, urls);
  }

  function fileCard(f, urls) {
    var isImage = /^image\/(png|jpe?g|gif|webp|avif)$/.test(f.type || '');
    var ext = (f.name.split('.').pop() || 'file').slice(0, 4).toUpperCase();
    return h('div', { class: 'workspace-file' },
      isImage && urls[f.path]
        ? h('img', { class: 'file-thumb', src: urls[f.path], alt: '', loading: 'lazy' })
        : h('div', { class: 'file-thumb ph' }, ext),
      h('div', { class: 'file-meta' },
        h('strong', { class: 'file-name' }, f.name),
        h('span', { class: 'file-size' }, Q.fmtBytes(f.size))),
      isImage && urls[f.path]
        ? h('a', { class: 'btn ghost small', href: urls[f.path], target: '_blank', rel: 'noopener' }, 'Preview')
        : null,
      h('button', { class: 'btn ghost small', type: 'button', onClick: function () { downloadFile(f); } }, 'Download'));
  }

  function declarationBlock(a) {
    return h('div', { class: 'info-grid four' },
      keyValue('Name', a.decl_name),
      keyValue('Position', a.decl_position),
      keyValue('Company', a.decl_company),
      keyValue('Declaration date', a.decl_date),
      h('div', { class: 'info-item declaration-signature' },
        h('span', { class: 'info-label' }, 'Signature'),
        Q.validSignature(a.signature)
          ? h('img', { class: 'sig-img', src: a.signature, alt: 'Client signature' })
          : h('span', { class: 'info-value muted' }, 'Not signed')));
  }

  function discoverySections(rec) {
    var a = rec.answers || {};
    return Q.SECTIONS.map(function (s, i) {
      var answerItems = s.fields.filter(function (f) { return f.type !== 'file'; }).map(function (f) {
        var value = Q.answerText(f, a);
        return h('div', { class: 'discovery-item' },
          h('span', { class: 'discovery-question' }, f.label),
          h('div', { class: 'discovery-answer' + (value ? '' : ' empty-answer') }, value || 'Not provided'));
      });
      return h('section', { class: 'discovery-section' },
        h('div', { class: 'discovery-section-head' },
          h('span', { class: 'section-number' }, String(i + 1).padStart(2, '0')),
          h('h2', null, s.title)),
        h('div', { class: 'discovery-answers' }, answerItems));
    });
  }

  function filesPanel(rec, urls) {
    var files = rec.files || [];
    if (!files.length) {
      return h('div', { class: 'empty-state compact' },
        h('div', { class: 'empty-icon' }, '↑'),
        h('strong', null, 'No client files yet'),
        h('p', null, 'Upload logos, content, branding or other project assets from Edit client.'));
    }
    var known = {};
    Q.FILE_FIELDS.forEach(function (f) { known[f.id] = f.label; });
    var groups = [];
    files.forEach(function (f) {
      var label = known[f.field] || 'Other files';
      var group = null;
      for (var i = 0; i < groups.length; i++) if (groups[i].label === label) group = groups[i];
      if (!group) { group = { label: label, files: [] }; groups.push(group); }
      group.files.push(f);
    });
    return h('div', { class: 'file-groups' }, groups.map(function (g) {
      return h('section', { class: 'file-group' },
        h('div', { class: 'file-group-head' }, h('h2', null, g.label), h('span', { class: 'hint' }, String(g.files.length))),
        h('div', { class: 'file-grid' }, g.files.map(function (f) { return fileCard(f, urls); })));
    }));
  }

  function notesPanel(rec) {
    var notes = h('textarea', {
      class: 'notes-editor',
      'aria-label': 'Internal notes',
      value: rec.staff_notes || '',
      placeholder: 'Keep private project notes here. These notes are only visible to staff.'
    });
    var saveNotes = h('button', { class: 'btn', type: 'button' }, 'Save notes');
    saveNotes.addEventListener('click', async function () {
      saveNotes.disabled = true;
      var r = await sb.from('submissions').update({ staff_notes: notes.value }).eq('id', rec.id);
      saveNotes.disabled = false;
      if (r.error) toast('Could not save notes');
      else { rec.staff_notes = notes.value; toast('Notes saved'); }
    });
    return h('div', { class: 'notes-panel' },
      h('div', { class: 'panel-intro' },
        h('h2', null, 'Internal notes'),
        h('p', { class: 'hint' }, 'Private working notes for your team. They are not shown to the client.')),
      notes,
      h('div', { class: 'notes-actions' }, saveNotes));
  }

  function renderDetail(rec, urls) {
    var a = rec.answers || {};
    var files = rec.files || [];
    var statusSel = h('select', {
      'aria-label': 'Status',
      onChange: async function (e) {
        var v = e.target.value;
        if (v === rec.status) return;
        var r = await sb.from('submissions').update({ status: v }).eq('id', rec.id);
        if (r.error) {
          console.error(r.error);
          toast('That status change is not allowed');
          e.target.value = rec.status;
        } else {
          rec.status = v;
          toast('Status updated');
          renderDetail(rec, urls);
        }
      }
    }, allowedStatusOptions(rec.status).map(function (value) {
      return h('option', { value: value, selected: rec.status === value }, statusLabel(value));
    }));

    var delBtn = h('button', { class: 'btn ghost danger', type: 'button' }, 'Delete');
    delBtn.addEventListener('click', async function () {
      if (!window.confirm('Delete "' + (rec.company_name || 'this submission') + '" and all of its uploaded files? This cannot be undone.')) return;
      delBtn.disabled = true;
      if (files.length) {
        var rm = await sb.storage.from(BUCKET).remove(files.map(function (f) { return f.path; }));
        if (rm.error) { toast('Could not delete the files'); delBtn.disabled = false; return; }
      }
      var res = await sb.from('submissions').delete().eq('id', rec.id);
      if (res.error) { toast('Could not delete this submission'); delBtn.disabled = false; return; }
      toast('Deleted');
      showList(false);
    });

    var tabNames = [
      ['overview', 'Overview'],
      ['discovery', 'Discovery'],
      ['files', 'Files' + (files.length ? ' (' + files.length + ')' : '')],
      ['payments', 'Payments'],
      ['notes', 'Notes']
    ];
    var tabs = h('nav', { class: 'detail-tabs', 'aria-label': 'Client sections' });
    tabNames.forEach(function (tab) {
      tabs.appendChild(h('button', {
        class: 'detail-tab' + (activeTab === tab[0] ? ' active' : ''),
        type: 'button',
        'aria-current': activeTab === tab[0] ? 'page' : null,
        onClick: function () {
          activeTab = tab[0];
          pushHistory('detail', { id: rec.id, tab: activeTab });
          renderDetail(rec, urls);
        }
      }, tab[1]));
    });

    var panel;
    if (activeTab === 'discovery') {
      panel = h('div', { class: 'discovery-panel' }, discoverySections(rec));
    } else if (activeTab === 'payments') {
      panel = h('div', { class: 'workspace-panel' }, paymentPanel(rec));
    } else if (activeTab === 'files') {
      panel = h('div', { class: 'workspace-panel' },
        h('div', { class: 'panel-toolbar' },
          h('div', null,
            h('h2', null, 'Project files'),
            h('p', { class: 'hint' }, 'Client assets stored in the private project bucket.')),
          h('button', { class: 'btn', type: 'button', onClick: function () { showEdit(rec); } }, 'Manage files')),
        filesPanel(rec, urls));
    } else if (activeTab === 'notes') {
      panel = h('div', { class: 'workspace-panel' }, notesPanel(rec));
    } else {
      panel = h('div', { class: 'overview-panel' },
        h('div', { class: 'overview-grid' },
          h('section', { class: 'workspace-card' },
            h('div', { class: 'card-title-row' }, h('h2', null, 'Project overview'), statusPill(rec.status)),
            h('div', { class: 'info-grid' },
              keyValue('Company', rec.company_name),
              keyValue('Primary contact', rec.contact_name),
              keyValue('Source', rec.source === 'staff' ? 'Staff entry' : 'Client submission'),
              keyValue('Submitted', fmtDate(rec.created_at)),
              keyValue('Last updated', rec.updated_at ? fmtDate(rec.updated_at) : fmtDate(rec.created_at)),
              keyValue('Files', files.length ? String(files.length) : '0'))),
          h('section', { class: 'workspace-card' },
            h('div', { class: 'card-title-row' }, h('h2', null, 'Quick discovery'), h('span', { class: 'hint' }, 'Key answers')),
            h('div', { class: 'info-grid' },
              keyValue('Website purpose', answerValue('purpose', a)),
              keyValue('Domain', answerValue('domain_name', a)),
              keyValue('Hosting', answerValue('hosting_provider', a)),
              keyValue('Email system', answerValue('email_system', a)),
              keyValue('Expected launch', answerValue('launch_date', a)),
              keyValue('Primary contact for approvals', answerValue('primary_contact', a)))),
          h('section', { class: 'workspace-card full' },
            h('div', { class: 'card-title-row' }, h('h2', null, 'Client declaration'), h('span', { class: 'hint' }, Q.validSignature(a.signature) ? 'Signed' : 'Not signed')),
            declarationBlock(a))));
    }

    mount(shell(h('main', { class: 'workspace-main detail-workspace' },
      h('div', { class: 'detail-head' },
        h('button', { class: 'back-link', type: 'button', onClick: function () { showList(false); } }, '‹ Back to submissions'),
        h('div', { class: 'detail-title-row' },
          h('div', null,
            h('p', { class: 'eyebrow' }, 'CLIENT PROJECT'),
            h('h1', { class: 'detail-title' }, rec.company_name || 'Untitled company'),
            h('p', { class: 'detail-subtitle' },
              (rec.contact_name || 'No contact name') + ' · ' + (rec.source === 'staff' ? 'Added by staff' : 'Submitted by client') + ' · ' + fmtDate(rec.created_at))),
          h('div', { class: 'detail-actions' }, statusSel,
            h('button', { class: 'btn', type: 'button', onClick: function () { showEdit(rec); } }, 'Edit client'),
            delBtn))),
      tabs,
      panel)));
  }

  /* --------------------------- create / edit --------------------------- */

  function showEdit(rec, navigate) {
    var isNew = !rec;
    if (navigate === undefined) navigate = true;
    if (navigate && navigationReady) pushHistory('edit', { id: rec ? rec.id : null });
    navigationReady = true;
    var id = isNew ? Q.uuid() : rec.id;
    var state = {
      answers: isNew ? { decl_date: Q.today() } : JSON.parse(JSON.stringify(rec.answers || {})),
      existingFiles: isNew ? [] : (rec.files || []).slice(),
      pending: {},
      removedPaths: []
    };

    var formRoot = h('div', { id: 'form' });
    Q.buildForm(formRoot, state, { allowRemoveExisting: true });

    var status = h('span', { class: 'hint', style: 'margin:0' });
    var saveBtn = h('button', { class: 'btn', type: 'button' }, isNew ? 'Create entry' : 'Save changes');
    var cancelBtn = h('button', {
      class: 'btn ghost',
      type: 'button',
      onClick: function () { if (isNew) showList(false); else showDetail(id, 'files', false); }
    }, 'Cancel');

    saveBtn.addEventListener('click', async function () {
      var a = state.answers;
      if (!String(a.company_name || '').trim()) {
        Q.markInvalid(formRoot, ['company_name']);
        var w = document.getElementById('wrap_company_name');
        if (w) w.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      try {
        var uploaded = await Q.uploadPending(sb, id, state, function (n, total, name) {
          status.textContent = 'Uploading file ' + n + ' of ' + total + ': ' + name;
        });
        status.textContent = 'Saving...';
        var files = state.existingFiles.concat(uploaded);
        var payload = {
          company_name: String(a.company_name).trim(),
          contact_name: String(a.decl_name || '').trim() || null,
          answers: a,
          files: files
        };
        var res;
        if (isNew) {
          payload.id = id;
          payload.status = 'new';
          payload.source = 'staff';
          res = await sb.from('submissions').insert(payload);
        } else {
          res = await sb.from('submissions').update(payload).eq('id', id);
        }
        if (res.error) throw res.error;
        if (state.removedPaths.length) await sb.storage.from(BUCKET).remove(state.removedPaths);
        toast(isNew ? 'Entry created' : 'Changes saved');
        showDetail(id, isNew ? 'overview' : 'files', false);
        replaceHistory('detail', { id: id, tab: isNew ? 'overview' : 'files' });
      } catch (err) {
        console.error(err);
        status.textContent = 'Could not save. Check your connection and try again.';
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    mount(shell(h('main', { class: 'workspace-main' },
      h('div', { class: 'edit-head' },
        h('button', { class: 'back-link', type: 'button', onClick: function () { isNew ? showList(false) : showDetail(id, 'files', false); } }, '‹ Back'),
        h('div', null,
          h('p', { class: 'eyebrow' }, isNew ? 'NEW PROJECT' : 'EDIT PROJECT'),
          h('h1', { class: 'page-title' }, isNew ? 'New client entry' : 'Edit ' + (rec.company_name || 'submission')),
          h('p', { class: 'page-subtitle' }, isNew ? 'Add what you know now. Only the company name is required.' : 'Update discovery answers, manage files and keep the project record current.'))),
      h('div', { class: 'edit-form-card' }, formRoot),
      h('div', { class: 'edit-actions' }, saveBtn, cancelBtn, status))));
  }

  init();
})();
