/* ---------------------------------------------------------------------
   Staff dashboard: sign in, see every submission, create / edit / delete
   entries, download client files, change status, add internal notes,
   export everything to CSV.
   Access is enforced by the database rules in supabase-setup.sql, not by
   this page.
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

  /* ------------------------------ utilities ------------------------------ */

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
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
      h('div', { class: 'topbar' },
        h('div', { class: 'topbar-title' }, 'Client Discovery Portal · Staff'),
        h('div', { class: 'topbar-right' },
          userEmail ? h('span', { class: 'hint' }, userEmail) : null,
          userEmail ? h('button', { class: 'btn ghost small', type: 'button', onClick: signOut }, 'Sign out') : null)),
      content);
  }

  function errorView(msg) {
    return shell(h('div', null,
      h('div', { class: 'banner' }, msg),
      h('button', { class: 'btn ghost', type: 'button', onClick: showList }, 'Back to list')));
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
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stops spreadsheet formula injection
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
      h('div', { class: 'loginbox' },
        h('h1', { style: 'font-size:28px' }, 'Staff sign in'),
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
    mount(shell(h('p', { class: 'hint' }, 'Loading submissions...')));
    var res = await sb.from('submissions')
      .select('id,created_at,status,source,company_name,contact_name,files')
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
    var box = h('div', { class: 'list' });
    var count = h('span', { class: 'hint' });

    function draw() {
      var q = filter.q.trim().toLowerCase();
      var shown = rows.filter(function (r) {
        var okStatus = filter.status === 'all' || r.status === filter.status;
        var hay = ((r.company_name || '') + ' ' + (r.contact_name || '')).toLowerCase();
        return okStatus && (!q || hay.indexOf(q) !== -1);
      });
      count.textContent = shown.length + ' of ' + rows.length;
      box.textContent = '';
      if (!rows.length) {
        box.appendChild(h('div', { class: 'empty' },
          h('strong', null, 'No submissions yet.'),
          h('p', null, 'When a client submits the questionnaire it will show up here. You can also add an entry yourself with "New entry".')));
        return;
      }
      if (!shown.length) {
        box.appendChild(h('p', { class: 'hint', style: 'padding:12px 0' }, 'No matches for that search.'));
        return;
      }
      shown.forEach(function (r) {
        var nFiles = (r.files || []).length;
        box.appendChild(h('button', { class: 'row', type: 'button', onClick: function () { showDetail(r.id); } },
          h('span', { class: 'row-main' },
            h('strong', null, r.company_name || 'Untitled company'),
            h('span', { class: 'hint' }, (r.contact_name || 'No contact name') + (r.source === 'staff' ? ' (added by staff)' : ''))),
          h('span', { class: 'row-meta' },
            h('span', { class: 'pill ' + r.status }, statusLabel(r.status)),
            h('span', null, fmtDate(r.created_at)),
            h('span', { class: 'hint' }, nFiles + (nFiles === 1 ? ' file' : ' files')))));
      });
    }

    var search = h('input', {
      type: 'text',
      placeholder: 'Search by company or contact',
      'aria-label': 'Search submissions',
      value: filter.q,
      onInput: function (e) { filter.q = e.target.value; draw(); }
    });
    var statusSel = h('select', {
      'aria-label': 'Filter by status',
      onChange: function (e) { filter.status = e.target.value; draw(); }
    }, h('option', { value: 'all' }, 'All statuses'),
      STATUSES.map(function (s) { return h('option', { value: s[0], selected: filter.status === s[0] }, s[1]); }));

    var exportBtn = h('button', { class: 'btn ghost', type: 'button' }, 'Export all (CSV)');
    exportBtn.addEventListener('click', async function () {
      exportBtn.disabled = true;
      var res = await sb.from('submissions').select('*').order('created_at', { ascending: false });
      exportBtn.disabled = false;
      if (res.error) { toast('Could not export'); return; }
      downloadText('questionnaire-submissions.csv', buildCsv(res.data || []), 'text/csv');
    });

    mount(shell(h('div', null,
      h('div', { class: 'page-head' },
        h('div', null, h('h1', { class: 'page-title' }, 'Submissions'), count),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', type: 'button', onClick: function () { showEdit(null); } }, 'New entry'),
          exportBtn,
          h('button', { class: 'btn ghost', type: 'button', onClick: showList }, 'Refresh'))),
      h('div', { class: 'toolbar' }, search, statusSel),
      box)));
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

  async function showDetail(id) {
    mount(shell(h('p', { class: 'hint' }, 'Loading...')));
    var res = await sb.from('submissions').select('*').eq('id', id).single();
    if (res.error || !res.data) { console.error(res.error); mount(errorView('Could not open this submission.')); return; }
    var rec = res.data;
    var urls = await signedUrls(rec.files);
    renderDetail(rec, urls);
  }

  function fileCard(f, urls) {
    var isImage = /^image\/(png|jpe?g|gif|webp|avif)$/.test(f.type || '');
    var ext = (f.name.split('.').pop() || 'file').slice(0, 4).toUpperCase();
    return h('div', { class: 'file-card' },
      isImage && urls[f.path]
        ? h('img', { class: 'thumb', src: urls[f.path], alt: '', loading: 'lazy' })
        : h('div', { class: 'thumb ph' }, ext),
      h('div', { class: 'file-meta' },
        h('span', { class: 'file-name' }, f.name),
        h('span', { class: 'file-size' }, Q.fmtBytes(f.size))),
      h('button', { class: 'btn ghost small', type: 'button', onClick: function () { downloadFile(f); } }, 'Download'));
  }

  function renderDetail(rec, urls) {
    var a = rec.answers || {};
    var files = rec.files || [];
    var known = {};
    Q.FILE_FIELDS.forEach(function (f) { known[f.id] = true; });

    var statusSel = h('select', {
      'aria-label': 'Status',
      onChange: async function (e) {
        var v = e.target.value;
        var r = await sb.from('submissions').update({ status: v }).eq('id', rec.id);
        if (r.error) { toast('Could not update status'); e.target.value = rec.status; }
        else { rec.status = v; toast('Status updated'); }
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

    var sections = Q.SECTIONS.map(function (s, i) {
      var items = s.fields.map(function (f) {
        if (f.type === 'file') {
          var mine = files.filter(function (x) { return x.field === f.id; });
          return h('div', { class: 'qa' },
            h('div', { class: 'qa-q' }, f.label),
            mine.length ? mine.map(function (x) { return fileCard(x, urls); }) : h('div', { class: 'qa-a none' }, 'No files uploaded'));
        }
        var t = Q.answerText(f, a);
        return h('div', { class: 'qa' },
          h('div', { class: 'qa-q' }, f.label),
          h('div', { class: 'qa-a' + (t ? '' : ' none') }, t || 'No answer'));
      });
      return h('section', { class: 'sec' },
        h('div', { class: 'sec-h' }, h('div', { class: 'sec-n' }, String(i + 1)), h('h2', { class: 'sec-t' }, s.title)),
        h('div', { class: 'sec-b' }, items));
    });

    var strays = files.filter(function (x) { return !known[x.field]; });
    if (strays.length) {
      sections.push(h('section', { class: 'sec' },
        h('div', { class: 'sec-h' }, h('h2', { class: 'sec-t' }, 'Other files')),
        h('div', { class: 'sec-b' }, strays.map(function (x) { return fileCard(x, urls); }))));
    }

    var line = function (label, value) {
      return h('div', { class: 'qa' }, h('div', { class: 'qa-q' }, label), h('div', { class: 'qa-a' + (value ? '' : ' none') }, value || 'No answer'));
    };
    sections.push(h('section', { class: 'sec' },
      h('div', { class: 'sec-h' }, h('h2', { class: 'sec-t' }, 'Client declaration')),
      h('div', { class: 'sec-b' },
        line('Name', a.decl_name), line('Position', a.decl_position), line('Company', a.decl_company), line('Date', a.decl_date),
        h('div', { class: 'qa' },
          h('div', { class: 'qa-q' }, 'Signature'),
          Q.validSignature(a.signature)
            ? h('img', { class: 'sig-img', src: a.signature, alt: 'Client signature' })
            : h('div', { class: 'qa-a none' }, 'Not signed')))));

    var notes = h('textarea', { 'aria-label': 'Internal notes', value: rec.staff_notes || '', placeholder: 'Notes only your team can see' });
    var saveNotes = h('button', { class: 'btn ghost small', type: 'button', style: 'margin-top:8px' }, 'Save notes');
    saveNotes.addEventListener('click', async function () {
      var r = await sb.from('submissions').update({ staff_notes: notes.value }).eq('id', rec.id);
      if (r.error) toast('Could not save notes'); else { rec.staff_notes = notes.value; toast('Notes saved'); }
    });
    sections.push(h('section', { class: 'sec' },
      h('div', { class: 'sec-h' }, h('h2', { class: 'sec-t' }, 'Internal notes')),
      h('div', { class: 'sec-b notes' }, notes, saveNotes)));

    mount(shell(h('div', { class: 'detail' },
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', { class: 'page-title' }, rec.company_name || 'Untitled company'),
          h('div', { class: 'hint', style: 'margin:0' },
            (rec.source === 'staff' ? 'Added by staff ' : 'Submitted ') + fmtDate(rec.created_at) +
            (rec.updated_at && rec.updated_at !== rec.created_at ? '. Last edited ' + fmtDate(rec.updated_at) : ''))),
        h('div', { class: 'actions' },
          statusSel,
          h('button', { class: 'btn', type: 'button', onClick: function () { showEdit(rec); } }, 'Edit'),
          delBtn,
          h('button', { class: 'btn ghost', type: 'button', onClick: showList }, 'Back to list'))),
      sections)));
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
        // Only remove files from storage once the record no longer points at them
        if (state.removedPaths.length) await sb.storage.from(BUCKET).remove(state.removedPaths);
        toast(isNew ? 'Entry created' : 'Changes saved');
        showDetail(id);
      } catch (err) {
        console.error(err);
        status.textContent = 'Could not save. Check your connection and try again.';
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    mount(shell(h('div', null,
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', { class: 'page-title' }, isNew ? 'New entry' : 'Edit ' + (rec.company_name || 'submission')),
          h('div', { class: 'hint', style: 'margin:0' },
            isNew ? 'Fill in what you know. Only the company name is required.' : 'Change any answer, add files, or remove files.'))),
      formRoot,
      h('div', { class: 'edit-actions' }, saveBtn, cancelBtn, status))));
  }

  init();
})();
