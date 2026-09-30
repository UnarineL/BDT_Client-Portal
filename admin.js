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
  var statusLabel = function (v) {
    for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i][0] === v) return STATUSES[i][1];
    return v;
  };

  var userEmail = '';
  var rows = [];
  var filter = { q: '', status: 'all' };
  var activeTab = 'overview';

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
      h('button', { class: 'btn ghost', type: 'button', onClick: showList }, 'Back to workspace')));
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
      enter();
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
    await sb.auth.signOut();
    userEmail = '';
    rows = [];
    showLogin();
  }

  async function enter() {
    var res = await sb.rpc('is_staff');
    if (res.error || !res.data) {
      await sb.auth.signOut();
      userEmail = '';
      showLogin('This account does not have staff access.');
      return;
    }
    showList();
  }

  async function init() {
    var res = await sb.auth.getSession();
    var session = res.data && res.data.session;
    if (session) {
      userEmail = session.user.email || '';
      enter();
    } else {
      showLogin();
    }
  }

  /* -------------------------------- list -------------------------------- */

  async function showList() {
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
          h('button', { class: 'btn ghost', type: 'button', onClick: showList }, 'Refresh'))),
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

  async function showDetail(id, tab) {
    activeTab = tab || 'overview';
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
        var r = await sb.from('submissions').update({ status: v }).eq('id', rec.id);
        if (r.error) { toast('Could not update status'); e.target.value = rec.status; }
        else { rec.status = v; toast('Status updated'); renderDetail(rec, urls); }
      }
    }, STATUSES.map(function (s) { return h('option', { value: s[0], selected: rec.status === s[0] }, s[1]); }));

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
      showList();
    });

    var tabNames = [
      ['overview', 'Overview'],
      ['discovery', 'Discovery'],
      ['files', 'Files' + (files.length ? ' (' + files.length + ')' : '')],
      ['notes', 'Notes']
    ];
    var tabs = h('nav', { class: 'detail-tabs', 'aria-label': 'Client sections' });
    tabNames.forEach(function (tab) {
      tabs.appendChild(h('button', {
        class: 'detail-tab' + (activeTab === tab[0] ? ' active' : ''),
        type: 'button',
        'aria-current': activeTab === tab[0] ? 'page' : null,
        onClick: function () { activeTab = tab[0]; renderDetail(rec, urls); }
      }, tab[1]));
    });

    var panel;
    if (activeTab === 'discovery') {
      panel = h('div', { class: 'discovery-panel' }, discoverySections(rec));
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
        h('button', { class: 'back-link', type: 'button', onClick: showList }, '‹ Back to submissions'),
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

  function showEdit(rec) {
    var isNew = !rec;
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
      onClick: function () { if (isNew) showList(); else showDetail(id); }
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
        showDetail(id, isNew ? 'overview' : 'files');
      } catch (err) {
        console.error(err);
        status.textContent = 'Could not save. Check your connection and try again.';
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    mount(shell(h('main', { class: 'workspace-main' },
      h('div', { class: 'edit-head' },
        h('button', { class: 'back-link', type: 'button', onClick: function () { isNew ? showList() : showDetail(id); } }, '‹ Back'),
        h('div', null,
          h('p', { class: 'eyebrow' }, isNew ? 'NEW PROJECT' : 'EDIT PROJECT'),
          h('h1', { class: 'page-title' }, isNew ? 'New client entry' : 'Edit ' + (rec.company_name || 'submission')),
          h('p', { class: 'page-subtitle' }, isNew ? 'Add what you know now. Only the company name is required.' : 'Update discovery answers, manage files and keep the project record current.'))),
      h('div', { class: 'edit-form-card' }, formRoot),
      h('div', { class: 'edit-actions' }, saveBtn, cancelBtn, status))));
  }

  init();
})();
