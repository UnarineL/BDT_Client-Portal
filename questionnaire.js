/* ---------------------------------------------------------------------
   Shared code: the questionnaire content + the form renderer.
   Used by the client form (index.html) and the staff editor (admin.html).

   To change a question, edit SECTIONS below. Field types:
   text, textarea, date, radio, checks, group, file
   --------------------------------------------------------------------- */
(function () {
  'use strict';

  var BUCKET = 'client-files';
  var MAX_FILE_MB = 25;
  var MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
  var MAX_FILES_PER_FIELD = 10;

  function yn(id, label, hint, opts) {
    return { id: id, label: label, hint: hint, type: 'radio', options: opts || ['Yes', 'No'] };
  }

  var SECTIONS = [
    {
      id: 's1',
      title: 'Company information',
      fields: [
        { id: 'company_name', label: 'What is the name of your company?', type: 'text', required: true },
        { id: 'products', label: 'What products or services do you offer?', type: 'textarea' },
        { id: 'description', label: 'Can you provide a brief description of your business?', type: 'textarea' },
        { id: 'audience', label: 'Who is your target audience?', type: 'textarea' }
      ]
    },
    {
      id: 's2',
      title: 'Website goals and objectives',
      fields: [
        {
          id: 'purpose',
          label: 'What is the primary purpose of the website?',
          hint: 'Select one option.',
          type: 'radio',
          options: ['Company profile', 'Lead generation', 'Online sales (eCommerce)', 'Customer support', 'Booking system', 'Portfolio showcase', 'Other']
        },
        { id: 'goals', label: 'What specific business goals would you like the website to achieve?', type: 'textarea' },
        { id: 'success', label: 'How will you measure the success of the website?', type: 'textarea' }
      ]
    },
    {
      id: 's3',
      title: 'Design preferences',
      fields: [
        { id: 'inspiration', label: 'Are there any websites you like and would like us to use as inspiration?', hint: 'Paste links if you can.', type: 'textarea' },
        { id: 'branding', label: 'Do you have existing branding guidelines? If yes, please provide.', hint: 'Tell us where to find them, or upload the file below.', type: 'textarea' },
        { id: 'branding_files', label: 'Upload your branding guidelines', hint: 'Optional.', type: 'file' },
        { id: 'logo', label: 'Do you have a company logo? If yes, please provide.', hint: 'Tell us where to find it, or upload the file below.', type: 'textarea' },
        { id: 'logo_files', label: 'Upload your logo', hint: 'Optional. PNG, SVG, PDF or AI files all work.', type: 'file' },
        { id: 'colours', label: 'What colours would you like to use?', type: 'text' },
        {
          id: 'style',
          label: 'What overall style do you prefer?',
          hint: 'Select all that apply.',
          type: 'checks',
          options: ['Modern', 'Corporate', 'Minimalistic', 'Creative', 'Luxury', 'Other']
        }
      ]
    },
    {
      id: 's4',
      title: 'Website content',
      fields: [
        yn('has_content', 'Do you have existing content for the website?'),
        {
          id: 'will_provide',
          label: 'Will you provide:',
          hint: 'Select all that apply.',
          type: 'checks',
          options: ['Text content', 'Images', 'Videos', 'Brochures', 'Testimonials', 'Product information']
        },
        { id: 'content_files', label: 'Upload your content files', hint: 'Optional. Images, brochures, testimonials, product information and so on.', type: 'file' },
        { id: 'content_links', label: 'Links to large files', hint: 'Videos and other large files are easier to share as a link (Google Drive, Dropbox, WeTransfer).', type: 'textarea' }
      ]
    },
    {
      id: 's5',
      title: 'Website structure',
      fields: [
        {
          id: 'pages',
          label: 'Which pages would you like included?',
          hint: 'Tick all that apply.',
          type: 'checks',
          options: ['Home', 'About Us', 'Services', 'Products', 'Contact Us', 'Careers', 'Blog', 'FAQ', 'Gallery', 'Other']
        },
        {
          id: 'features',
          label: 'Are there any special features you require?',
          hint: 'Tick all that apply.',
          type: 'checks',
          options: ['Online forms', 'Live chat', 'Booking system', 'Membership portal', 'Customer login', 'Payment gateway', 'Newsletter subscription', 'CRM integration', 'Other']
        }
      ]
    },
    {
      id: 's6',
      title: 'Domain and hosting information',
      fields: [
        yn('owns_domain', 'Do you currently own a domain name?', null, ['Yes', 'No', 'Not sure']),
        { id: 'domain_name', label: 'What is the domain name?', type: 'text' },
        { id: 'registrar', label: 'Who is the domain registrar?', type: 'text' },
        { id: 'domain_manager', label: 'Who currently manages the domain?', type: 'text' },
        { id: 'hosting_provider', label: 'Does the company have a hosting provider?', hint: 'If yes, tell us who.', type: 'text' },
        { id: 'hosting_manager', label: 'Who manages the hosting account?', type: 'text' },
        {
          id: 'access_contact',
          label: 'Can you provide access or contact details for the person managing the hosting and domain?',
          hint: "Name, email and phone number are enough. Please don't include passwords.",
          type: 'textarea'
        }
      ]
    },
    {
      id: 's7',
      title: 'Email configuration',
      fields: [
        {
          id: 'email_system',
          label: 'What email system is currently being used?',
          hint: 'Select one option.',
          type: 'radio',
          options: ['Microsoft 365', 'Google Workspace', 'Hosted Exchange', 'Other']
        },
        { id: 'email_addresses', label: 'What email addresses are associated with the domain?', type: 'textarea' },
        { id: 'email_manager', label: 'Who manages the email environment?', type: 'text' },
        {
          id: 'admin_access',
          label: 'Who has administrative access to:',
          type: 'group',
          items: [
            { key: 'domain_reg', label: 'Domain registration' },
            { key: 'dns', label: 'DNS records' },
            { key: 'm365_google', label: 'Microsoft 365 / Google Workspace' },
            { key: 'hosting', label: 'Website hosting' }
          ]
        },
        {
          id: 'shared_mailboxes',
          label: 'Are there distribution lists or shared mailboxes that need to be preserved?',
          hint: 'Tell us Yes or No, and list them if you can.',
          type: 'textarea'
        }
      ]
    },
    {
      id: 's8',
      title: 'User access and administration',
      fields: [
        { id: 'site_admins', label: 'Who should have administrative access to the website?', type: 'textarea' },
        { id: 'content_owner', label: 'Who will be responsible for maintaining website content?', type: 'textarea' }
      ]
    },
    {
      id: 's9',
      title: 'Security requirements',
      fields: [
        yn('ssl', 'Do you require SSL (HTTPS)?'),
        {
          id: 'compliance',
          label: 'Are there any compliance requirements?',
          hint: 'Select all that apply.',
          type: 'checks',
          options: ['POPIA', 'GDPR', 'ISO 27001', 'PCI DSS', 'Other']
        },
        yn('audit_log', 'Do you need audit logging of website changes?')
      ]
    },
    {
      id: 's10',
      title: 'Integrations',
      fields: [
        {
          id: 'integrations',
          label: 'Should the website integrate with:',
          hint: 'Tick all that apply.',
          type: 'checks',
          options: ['Microsoft 365', 'CRM system', 'Social media accounts', 'ERP system', 'WhatsApp', 'Payment gateways', 'Google Analytics']
        }
      ]
    },
    {
      id: 's11',
      title: 'Project',
      fields: [
        { id: 'launch_date', label: 'What is your expected launch date?', type: 'date' },
        { id: 'future_phases', label: 'Are there any future phases or features planned?', type: 'textarea' },
        { id: 'primary_contact', label: 'Who will be the primary contact person for approvals and feedback?', type: 'text' },
        yn('maintenance', 'Do you require ongoing website maintenance and support?')
      ]
    }
  ];

  var ALL_FIELDS = [];
  SECTIONS.forEach(function (s) { s.fields.forEach(function (f) { ALL_FIELDS.push(f); }); });
  var QUESTION_FIELDS = ALL_FIELDS.filter(function (f) { return f.type !== 'file'; });
  var FILE_FIELDS = ALL_FIELDS.filter(function (f) { return f.type === 'file'; });

  var DECLARATION = 'I confirm that the information provided above is accurate and complete to the best of my knowledge.';
  var THANK_YOU = 'Thank you for completing this questionnaire. This information will help us design and deliver a website that meets your business objectives while ensuring a smooth domain, email, hosting, and website management transition.';

  /* ----------------------------- helpers ----------------------------- */

  function today() { return new Date().toISOString().slice(0, 10); }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 3) | 8).toString(16);
    });
  }

  function fmtBytes(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function safeName(name) {
    var s = String(name || 'file').normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '');
    return s.slice(-80) || 'file';
  }

  function isEmpty(f, a) {
    var v = a[f.id];
    if (f.type === 'checks') return !(v && v.length);
    if (f.type === 'group') {
      return !v || Object.keys(v).every(function (k) { return !String(v[k] || '').trim(); });
    }
    return !String(v == null ? '' : v).trim();
  }

  function answerText(f, a) {
    var v = a[f.id];
    var other = String(a[f.id + '_other'] || '').trim();
    if (f.type === 'checks') {
      return (v || []).map(function (o) { return o === 'Other' && other ? 'Other: ' + other : o; }).join(', ');
    }
    if (f.type === 'radio') {
      if (!v) return '';
      return v === 'Other' && other ? 'Other: ' + other : v;
    }
    if (f.type === 'group') {
      return f.items
        .map(function (it) {
          var t = String((v && v[it.key]) || '').trim();
          return t ? it.label + ': ' + t : null;
        })
        .filter(Boolean)
        .join('; ');
    }
    if (f.type === 'file') return '';
    return String(v == null ? '' : v).trim();
  }

  function calcProgress(a) {
    var done = QUESTION_FIELDS.filter(function (f) { return !isEmpty(f, a); }).length;
    return Math.round((done / QUESTION_FIELDS.length) * 100);
  }

  function validSignature(s) {
    return typeof s === 'string' && s.indexOf('data:image/png;base64,') === 0;
  }

  /* --------------------------- tiny DOM helper --------------------------- */
  // Builds elements without innerHTML, so client-supplied text can never run as code.

  function append(el, kid) {
    if (kid == null || kid === false) return;
    if (Array.isArray(kid)) { kid.forEach(function (k) { append(el, k); }); return; }
    if (kid.nodeType) el.appendChild(kid);
    else el.appendChild(document.createTextNode(String(kid)));
  }

  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  /* --------------------------- signature pad --------------------------- */

  function signaturePad(initial, onChange) {
    var c = h('canvas', {
      width: '640',
      height: '180',
      class: 'sig',
      'aria-label': 'Signature area. Draw your signature with a finger, stylus or mouse.'
    });
    var ctx = c.getContext('2d');
    var drawing = false;
    var last = null;

    if (validSignature(initial)) {
      var img = new Image();
      img.onload = function () { ctx.drawImage(img, 0, 0, c.width, c.height); };
      img.src = initial;
    }

    function pos(e) {
      var r = c.getBoundingClientRect();
      return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
    }
    function style() {
      ctx.strokeStyle = '#14212B';
      ctx.fillStyle = '#14212B';
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    }

    c.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      if (c.setPointerCapture) c.setPointerCapture(e.pointerId);
      drawing = true;
      last = pos(e);
      style();
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    });
    c.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pos(e);
      style();
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last = p;
    });
    function end() {
      if (!drawing) return;
      drawing = false;
      onChange(c.toDataURL('image/png'));
    }
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', end);

    return h('div', null,
      c,
      h('div', { class: 'sig-row' },
        h('span', { class: 'hint' }, 'Draw your signature above.'),
        h('button', {
          type: 'button',
          class: 'btn ghost small',
          onClick: function () {
            ctx.clearRect(0, 0, c.width, c.height);
            onChange('');
          }
        }, 'Clear signature')
      )
    );
  }

  /* --------------------------- validation UI --------------------------- */

  function clearInvalid(k) {
    var w = document.getElementById('wrap_' + k);
    if (w && w.classList.contains('invalid')) {
      w.classList.remove('invalid');
      var m = w.querySelector('.err-msg');
      if (m) m.remove();
    }
  }

  function markInvalid(root, ids) {
    root.querySelectorAll('.invalid').forEach(function (el) {
      el.classList.remove('invalid');
      var m = el.querySelector('.err-msg');
      if (m) m.remove();
    });
    ids.forEach(function (id) {
      var w = root.querySelector('#wrap_' + id);
      if (!w) return;
      w.classList.add('invalid');
      w.appendChild(h('div', { class: 'err-msg', role: 'alert' }, id === 'signature' ? 'Please sign above.' : 'This answer is required.'));
    });
  }

  /* ------------------------------ form ------------------------------ */
  // state = { answers:{}, existingFiles:[], pending:{fieldId:[File]}, removedPaths:[] }

  function buildForm(root, state, opts) {
    opts = opts || {};
    var answers = state.answers;
    state.pending = state.pending || {};
    state.existingFiles = state.existingFiles || [];
    state.removedPaths = state.removedPaths || [];

    function notify(k) {
      clearInvalid(k);
      if (opts.onChange) opts.onChange(k);
    }
    function set(k, v) { answers[k] = v; notify(k); }

    function labelEl(f, id) {
      return h('label', { class: 'lbl', for: id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null);
    }
    function hintEl(f) { return f.hint ? h('div', { class: 'hint' }, f.hint) : null; }

    function textEl(f) {
      var id = 'f_' + f.id;
      var control = f.type === 'textarea'
        ? h('textarea', { id: id, value: answers[f.id] || '', onInput: function (e) { set(f.id, e.target.value); } })
        : h('input', { id: id, type: f.type, value: answers[f.id] || '', onInput: function (e) { set(f.id, e.target.value); } });
      return h('div', { class: 'fld', id: 'wrap_' + f.id }, labelEl(f, id), hintEl(f), control);
    }

    function radioEl(f) {
      var current = function () { return answers[f.id]; };
      var items = [];
      var other = null;
      var optsBox = h('div', { class: 'opts' });

      function sync() {
        items.forEach(function (x) {
          x.label.classList.toggle('on', current() === x.o);
          x.input.checked = current() === x.o;
        });
        if (other) other.hidden = current() !== 'Other';
      }

      f.options.forEach(function (o) {
        var input = h('input', {
          type: 'radio',
          name: 'r_' + f.id,
          checked: current() === o,
          onChange: function () { set(f.id, o); sync(); }
        });
        var label = h('label', { class: 'opt' + (current() === o ? ' on' : '') }, input, h('span', null, o));
        items.push({ o: o, label: label, input: input });
        optsBox.appendChild(label);
      });

      if (f.options.indexOf('Other') !== -1) {
        other = h('input', {
          type: 'text',
          class: 'other',
          placeholder: 'Please specify',
          'aria-label': f.label + ' - other',
          value: answers[f.id + '_other'] || '',
          hidden: current() !== 'Other',
          onInput: function (e) { set(f.id + '_other', e.target.value); }
        });
      }

      return h('div', { class: 'fld', id: 'wrap_' + f.id },
        h('fieldset', null, h('legend', { class: 'lbl' }, f.label), hintEl(f), optsBox, other));
    }

    function checksEl(f) {
      var list = function () { return answers[f.id] || []; };
      var items = [];
      var other = null;
      var optsBox = h('div', { class: 'opts' });

      function sync() {
        items.forEach(function (x) { x.label.classList.toggle('on', list().indexOf(x.o) !== -1); });
        if (other) other.hidden = list().indexOf('Other') === -1;
      }

      f.options.forEach(function (o) {
        var input = h('input', {
          type: 'checkbox',
          checked: list().indexOf(o) !== -1,
          onChange: function () {
            var chosen = {};
            list().forEach(function (x) { chosen[x] = true; });
            if (input.checked) chosen[o] = true; else delete chosen[o];
            set(f.id, f.options.filter(function (x) { return chosen[x]; }));
            sync();
          }
        });
        var label = h('label', { class: 'opt' + (list().indexOf(o) !== -1 ? ' on' : '') }, input, h('span', null, o));
        items.push({ o: o, label: label });
        optsBox.appendChild(label);
      });

      if (f.options.indexOf('Other') !== -1) {
        other = h('input', {
          type: 'text',
          class: 'other',
          placeholder: 'Please specify',
          'aria-label': f.label + ' - other',
          value: answers[f.id + '_other'] || '',
          hidden: list().indexOf('Other') === -1,
          onInput: function (e) { set(f.id + '_other', e.target.value); }
        });
      }

      return h('div', { class: 'fld', id: 'wrap_' + f.id },
        h('fieldset', null, h('legend', { class: 'lbl' }, f.label), hintEl(f), optsBox, other));
    }

    function groupEl(f) {
      var g = answers[f.id] || (answers[f.id] = {});
      var rows = f.items.map(function (it) {
        var id = 'f_' + f.id + '_' + it.key;
        return h('div', { class: 'group-row' },
          h('label', { for: id }, it.label),
          h('input', {
            id: id,
            type: 'text',
            placeholder: 'Name or company',
            value: g[it.key] || '',
            onInput: function (e) { g[it.key] = e.target.value; notify(f.id); }
          }));
      });
      return h('div', { class: 'fld', id: 'wrap_' + f.id },
        h('fieldset', null, h('legend', { class: 'lbl' }, f.label), hintEl(f), h('div', { class: 'group' }, rows)));
    }

    function fileEl(f) {
      var id = 'f_' + f.id;
      var list = h('ul', { class: 'files' });
      var msg = h('div', { class: 'err-inline', hidden: true });

      function draw() {
        list.textContent = '';
        state.existingFiles.filter(function (x) { return x.field === f.id; }).forEach(function (rec) {
          list.appendChild(h('li', { class: 'file-row' },
            h('span', { class: 'file-name' }, rec.name),
            h('span', { class: 'file-size' }, fmtBytes(rec.size)),
            opts.allowRemoveExisting
              ? h('button', {
                  type: 'button',
                  class: 'btn ghost small',
                  onClick: function () {
                    state.existingFiles = state.existingFiles.filter(function (x) { return x.path !== rec.path; });
                    state.removedPaths.push(rec.path);
                    draw();
                    notify(f.id);
                  }
                }, 'Remove')
              : null));
        });
        (state.pending[f.id] || []).forEach(function (file, idx) {
          list.appendChild(h('li', { class: 'file-row' },
            h('span', { class: 'file-name' }, file.name),
            h('span', { class: 'file-size' }, fmtBytes(file.size)),
            h('button', {
              type: 'button',
              class: 'btn ghost small',
              onClick: function () {
                state.pending[f.id].splice(idx, 1);
                draw();
                notify(f.id);
              }
            }, 'Remove')));
        });
      }

      var input = h('input', {
        id: id,
        type: 'file',
        multiple: true,
        class: 'file-input',
        accept: f.accept,
        onChange: function () {
          var cur = (state.pending[f.id] = state.pending[f.id] || []);
          var problems = [];
          Array.prototype.forEach.call(input.files, function (file) {
            if (file.size > MAX_FILE_BYTES) problems.push(file.name + ' is larger than ' + MAX_FILE_MB + ' MB. Please share it as a link instead.');
            else if (cur.length >= MAX_FILES_PER_FIELD) problems.push('You can add up to ' + MAX_FILES_PER_FIELD + ' files here.');
            else cur.push(file);
          });
          input.value = '';
          msg.textContent = problems.join(' ');
          msg.hidden = problems.length === 0;
          draw();
          notify(f.id);
        }
      });

      draw();
      return h('div', { class: 'fld', id: 'wrap_' + f.id },
        h('label', { class: 'lbl', for: id }, f.label),
        hintEl(f),
        input,
        h('div', { class: 'hint small-hint' }, 'Up to ' + MAX_FILE_MB + ' MB per file.'),
        msg,
        list);
    }

    function fieldEl(f) {
      switch (f.type) {
        case 'radio': return radioEl(f);
        case 'checks': return checksEl(f);
        case 'group': return groupEl(f);
        case 'file': return fileEl(f);
        default: return textEl(f);
      }
    }

    function declaration() {
      return h('section', { class: 'sec', 'aria-labelledby': 'h_decl' },
        h('div', { class: 'sec-h' }, h('h2', { class: 'sec-t', id: 'h_decl' }, 'Client declaration')),
        h('div', { class: 'sec-b' },
          h('p', { class: 'decl' }, DECLARATION),
          textEl({ id: 'decl_name', label: 'Name', type: 'text', required: true }),
          textEl({ id: 'decl_position', label: 'Position', type: 'text' }),
          textEl({ id: 'decl_company', label: 'Company', type: 'text' }),
          h('div', { class: 'fld', id: 'wrap_signature' },
            h('div', { class: 'lbl' }, 'Signature', h('span', { class: 'req' }, ' *')),
            signaturePad(answers.signature, function (v) { set('signature', v); })),
          textEl({ id: 'decl_date', label: 'Date', type: 'date' })));
    }

    root.textContent = '';
    SECTIONS.forEach(function (s, i) {
      root.appendChild(h('section', { class: 'sec', 'aria-labelledby': 'h_' + s.id },
        h('div', { class: 'sec-h' },
          h('div', { class: 'sec-n', 'aria-hidden': 'true' }, String(i + 1)),
          h('h2', { class: 'sec-t', id: 'h_' + s.id }, s.title)),
        h('div', { class: 'sec-b' }, s.fields.map(fieldEl))));
    });
    root.appendChild(declaration());
  }

  /* --------------------------- file uploads --------------------------- */
  // Uploads every chosen file for this submission. Files that already uploaded
  // (for example on a retry after a network error) are not uploaded twice.

  async function uploadPending(sb, submissionId, state, onProgress) {
    var bucket = sb.storage.from(BUCKET);
    var jobs = [];
    Object.keys(state.pending || {}).forEach(function (fid) {
      state.pending[fid].forEach(function (file) { jobs.push({ fid: fid, file: file }); });
    });
    var out = [];
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      if (job.file._rec) { out.push(job.file._rec); continue; }
      if (onProgress) onProgress(i + 1, jobs.length, job.file.name);
      var path = submissionId + '/' + job.fid + '/' +
        Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7) + '-' + safeName(job.file.name);
      var res = await bucket.upload(path, job.file, {
        contentType: job.file.type || 'application/octet-stream',
        upsert: false
      });
      if (res.error) throw res.error;
      job.file._rec = { field: job.fid, path: path, name: job.file.name, size: job.file.size, type: job.file.type || '' };
      out.push(job.file._rec);
    }
    return out;
  }

  window.Q = {
    BUCKET: BUCKET,
    SECTIONS: SECTIONS,
    ALL_FIELDS: ALL_FIELDS,
    QUESTION_FIELDS: QUESTION_FIELDS,
    FILE_FIELDS: FILE_FIELDS,
    DECLARATION: DECLARATION,
    THANK_YOU: THANK_YOU,
    h: h,
    today: today,
    uuid: uuid,
    fmtBytes: fmtBytes,
    isEmpty: isEmpty,
    answerText: answerText,
    calcProgress: calcProgress,
    validSignature: validSignature,
    buildForm: buildForm,
    markInvalid: markInvalid,
    uploadPending: uploadPending
  };
})();
