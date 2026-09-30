/* ---------------------------------------------------------------------
   Client form page: draws the questionnaire, autosaves a draft in the
   visitor's browser, uploads files and saves the submission to Supabase.
   --------------------------------------------------------------------- */
(function () {
  'use strict';

  var Q = window.Q;
  var h = Q.h;
  var cfg = window.APP_CONFIG || {};
  var configured =
    cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !/YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);
  var sb = configured && window.supabase ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  var DRAFT_KEY = 'questionnaire_draft_v1';

  var el = function (id) { return document.getElementById(id); };
  var root = el('form');
  var banner = el('banner');
  var uploadStatus = el('upload-status');
  var submitBtn = el('submit');

  if (!configured) el('setup-warning').hidden = false;

  // Optional branding
  if (cfg.LOGO_URL) el('brand').appendChild(h('img', { class: 'brand-logo', src: cfg.LOGO_URL, alt: cfg.BRAND_NAME || '' }));
  else if (cfg.BRAND_NAME) el('brand').appendChild(h('div', { class: 'brand-name' }, cfg.BRAND_NAME));

  // State: answers are saved as a draft; chosen files stay in memory only
  var state = { answers: { decl_date: Q.today() }, existingFiles: [], pending: {}, removedPaths: [] };
  try {
    var draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (draft && typeof draft === 'object') Object.assign(state.answers, draft);
  } catch (e) { /* no usable draft */ }

  var submissionId = null; // kept between retries so uploads land in one folder

  function updateProgress() {
    var pct = Q.calcProgress(state.answers);
    el('pct').textContent = pct + '%';
    el('fill').style.width = pct + '%';
    el('track').setAttribute('aria-valuenow', String(pct));
  }

  var saveTimer = null;
  var done = false; // true once submitted, so the draft is never re-saved
  function onChange() {
    if (done) return;
    updateProgress();
    el('saved').textContent = 'Saving...';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(state.answers));
        el('saved').textContent = 'Draft saved';
      } catch (e) {
        el('saved').textContent = "Couldn't save draft";
      }
    }, 800);
  }

  Q.buildForm(root, state, { onChange: onChange });
  updateProgress();

  function showBanner(msg) {
    banner.textContent = msg;
    banner.hidden = !msg;
  }

  function showThanks() {
    done = true;
    clearTimeout(saveTimer);
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ }
    el('topbar').hidden = true;
    el('app').hidden = true;
    el('thanks-text').textContent = Q.THANK_YOU;
    el('thanks').hidden = false;
    window.scrollTo(0, 0);
  }

  async function submit() {
    showBanner('');
    if (!sb) {
      showBanner('This form is not connected yet. Please contact the person who sent you this link.');
      return;
    }
    // A filled spam-trap means a bot: pretend it worked and drop it
    if (el('hp').value) { showThanks(); return; }

    var a = state.answers;
    var missing = [];
    if (!String(a.company_name || '').trim()) missing.push('company_name');
    if (!String(a.decl_name || '').trim()) missing.push('decl_name');
    if (!a.signature) missing.push('signature');
    Q.markInvalid(root, missing);
    if (missing.length) {
      showBanner("A few required answers are missing. They're marked in red above.");
      var first = document.getElementById('wrap_' + missing[0]);
      if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    try {
      submissionId = submissionId || Q.uuid();
      uploadStatus.hidden = false;
      var files = await Q.uploadPending(sb, submissionId, state, function (n, total, name) {
        uploadStatus.textContent = 'Uploading file ' + n + ' of ' + total + ': ' + name;
      });
      uploadStatus.textContent = 'Saving your answers...';

      var res = await sb.from('submissions').insert({
        id: submissionId,
        status: 'new',
        source: 'client',
        company_name: String(a.company_name).trim(),
        contact_name: String(a.decl_name).trim(),
        answers: a,
        files: files
      });
      if (res.error) throw res.error;
      showThanks();
    } catch (err) {
      console.error(err);
      showBanner("We couldn't send your answers. Please check your connection and try again. Your answers are still on this page.");
      uploadStatus.hidden = true;
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit questionnaire';
    }
  }

  submitBtn.addEventListener('click', submit);
})();
