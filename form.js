/* ---------------------------------------------------------------------
   Client form page: draws the questionnaire, autosaves a draft in the
   visitor's browser, creates a submission, uploads files and finalizes
   the submission securely through Supabase RPC functions.
   --------------------------------------------------------------------- */
(function () {
  'use strict';

  var Q = window.Q;
  var h = Q.h;
  var cfg = window.APP_CONFIG || {};
  var configured =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !/YOUR-/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY);

  var sb =
    configured && window.supabase
      ? window.supabase.createClient(
          cfg.SUPABASE_URL,
          cfg.SUPABASE_ANON_KEY
        )
      : null;

  var DRAFT_KEY = 'questionnaire_draft_v1';

  var el = function (id) {
    return document.getElementById(id);
  };

  var root = el('form');
  var banner = el('banner');
  var uploadStatus = el('upload-status');
  var submitBtn = el('submit');

  if (!configured) {
    el('setup-warning').hidden = false;
  }

  // Optional branding
  if (cfg.LOGO_URL) {
    el('brand').appendChild(
      h('img', {
        class: 'brand-logo',
        src: cfg.LOGO_URL,
        alt: cfg.BRAND_NAME || ''
      })
    );
  } else if (cfg.BRAND_NAME) {
    el('brand').appendChild(
      h('div', { class: 'brand-name' }, cfg.BRAND_NAME)
    );
  }

  // State:
  // - answers are saved as a draft
  // - chosen files stay in memory only
  var state = {
    answers: { decl_date: Q.today() },
    existingFiles: [],
    pending: {},
    removedPaths: []
  };

  try {
    var draft = JSON.parse(
      localStorage.getItem(DRAFT_KEY) || 'null'
    );

    if (draft && typeof draft === 'object') {
      Object.assign(state.answers, draft);
    }
  } catch (e) {
    /* no usable draft */
  }

  // Kept between retries during this page session.
  var submissionId = null;
  var finalizeToken = null;

  function updateProgress() {
    var pct = Q.calcProgress(state.answers);

    el('pct').textContent = pct + '%';
    el('fill').style.width = pct + '%';
    el('track').setAttribute('aria-valuenow', String(pct));
  }

  var saveTimer = null;
  var done = false;

  // true once submitted, so the draft is never re-saved.
  function onChange() {
    if (done) return;

    updateProgress();

    el('saved').textContent = 'Saving...';

    clearTimeout(saveTimer);

    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify(state.answers)
        );

        el('saved').textContent = 'Draft saved';
      } catch (e) {
        el('saved').textContent = "Couldn't save draft";
      }
    }, 800);
  }

  Q.buildForm(root, state, {
    onChange: onChange
  });

  updateProgress();

  function showBanner(msg) {
    banner.textContent = msg;
    banner.hidden = !msg;
  }

  function showThanks() {
    done = true;

    clearTimeout(saveTimer);

    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch (e) {
      /* ignore */
    }

    el('topbar').hidden = true;
    el('app').hidden = true;
    el('thanks-text').textContent = Q.THANK_YOU;
    el('thanks').hidden = false;

    window.scrollTo(0, 0);
  }

  async function createClientSubmission(a) {
    var result = await sb.rpc('create_client_submission', {
      p_company_name: String(a.company_name).trim(),
      p_contact_name: String(a.decl_name).trim(),
      p_answers: a
    });

    if (result.error) {
      throw result.error;
    }

    var row = Array.isArray(result.data)
      ? result.data[0]
      : result.data;

    if (
      !row ||
      !row.submission_id ||
      !row.finalize_token
    ) {
      throw new Error(
        'Could not create the submission securely.'
      );
    }

    submissionId = row.submission_id;
    finalizeToken = row.finalize_token;

    return row;
  }

  async function uploadFiles() {
    uploadStatus.hidden = false;

    return await Q.uploadPending(
      sb,
      submissionId,
      state,
      function (n, total, name) {
        uploadStatus.textContent =
          'Uploading file ' +
          n +
          ' of ' +
          total +
          ': ' +
          name;
      }
    );
  }

  async function finalizeSubmission(files) {
    uploadStatus.textContent =
      'Finalizing your submission...';

    var result = await sb.rpc(
      'finalize_client_submission',
      {
        p_submission_id: submissionId,
        p_finalize_token: finalizeToken,
        p_files: files
      }
    );

    if (result.error) {
      throw result.error;
    }

    if (result.data !== true) {
      throw new Error(
        'Submission finalization was rejected.'
      );
    }

    // The token is single-use. Do not keep it after success.
    finalizeToken = null;
  }

  async function submit() {
    showBanner('');

    if (!sb) {
      showBanner(
        'This form is not connected yet. Please contact the person who sent you this link.'
      );
      return;
    }

    // A filled spam-trap means a bot:
    // pretend it worked and drop it.
    if (el('hp').value) {
      showThanks();
      return;
    }

    var a = state.answers;
    var missing = [];

    if (!String(a.company_name || '').trim()) {
      missing.push('company_name');
    }

    if (!String(a.decl_name || '').trim()) {
      missing.push('decl_name');
    }

    if (!a.signature) {
      missing.push('signature');
    }

    Q.markInvalid(root, missing);

    if (missing.length) {
      showBanner(
        "A few required answers are missing. They're marked in red above."
      );

      var first = document.getElementById(
        'wrap_' + missing[0]
      );

      if (first) {
        first.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }

      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
      /*
       * Phase 1:
       * Create the submission before uploading files.
       *
       * This is required by the hardened storage policy, which only
       * permits uploads into an existing client submission UUID.
       */
      if (!submissionId || !finalizeToken) {
        uploadStatus.hidden = false;
        uploadStatus.textContent =
          'Saving your answers...';

        await createClientSubmission(a);
      }

      /*
       * Phase 2:
       * Upload files into:
       *
       * <submission-id>/<field>/<filename>
       *
       * The storage policy verifies that the submission already exists.
       */
      var files = await uploadFiles();

      /*
       * Phase 3:
       * Finalize the submission through a SECURITY DEFINER RPC.
       *
       * Anonymous users never receive UPDATE permission on the
       * submissions table.
       */
      await finalizeSubmission(files);

      showThanks();
    } catch (err) {
      console.error(err);

      showBanner(
  "Submission failed: " +
  (err && err.message
    ? err.message
    : String(err))
);

      uploadStatus.hidden = true;

      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit questionnaire';
    }
  }

  submitBtn.addEventListener('click', submit);
})();
