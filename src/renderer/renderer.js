const DOC_TYPES = [
  'KTP', 'KK', 'Passport', 'Visa', "Driver's License", 'NPWP (Tax ID)',
  'Birth Certificate', 'Marriage Certificate',
  'CV', 'Cover Letter', 'Diploma', 'Certificate', 'Employment Letter', 'Bank Statement',
  'Other',
];
const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const $ = (id) => document.getElementById(id);

// All text (including model output and file names) is set via textContent, never innerHTML.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let people = [];
let current = null; // selected folder (full view)
let sub = 'docs';
let busy = false;
let filter = 'all';

// ---------- screens ----------
function showScreen(name) {
  $('empty').hidden = name !== 'empty';
  $('person').hidden = name !== 'person';
  $('settings').hidden = name !== 'settings';
}

function showSub(name) {
  sub = name;
  document.querySelectorAll('.sub').forEach((b) => b.classList.toggle('active', b.dataset.sub === name));
  $('docsTab').hidden = name !== 'docs';
  $('resultTab').hidden = name !== 'result';
}
document.querySelectorAll('.sub').forEach((b) => b.addEventListener('click', () => showSub(b.dataset.sub)));

$('openSettings').addEventListener('click', () => showScreen('settings'));
$('closeSettings').addEventListener('click', () => showScreen(current ? 'person' : 'empty'));

// ---------- folder list ----------
async function refreshPeople() {
  people = await window.api.listPeople();
  $('people').replaceChildren(
    ...people.map((p) => {
      let info = `${p.docCount} docs`;
      if (p.issueCount !== null) info += ` · ${p.issueCount} issues`;
      if (p.stale) info += ' ⚠';
      const li = h('li', p.id === current?.id ? { class: 'active' } : {}, h('span', {}, p.name), h('small', {}, info));
      li.addEventListener('click', () => selectPerson(p.id));
      return li;
    })
  );
}

async function selectPerson(id, keepSub = false) {
  current = await window.api.getPerson(id);
  store.set('lastPerson', id);
  filter = 'all';
  $('error').hidden = true;
  $('status').textContent = '';
  renderPerson();
  if (!keepSub) showSub(current.result ? 'result' : 'docs');
  showScreen('person');
  await refreshPeople();
}

// Inline editing: Enter saves, Esc cancels, leaving the field saves when it has text.
function inlineEdit(input, { onCommit, onCancel }) {
  let done = false;
  const finish = (fn) => { if (!done) { done = true; fn(); } };
  const commit = () => { const v = input.value.trim(); finish(() => (v ? onCommit(v) : onCancel())); };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') finish(onCancel);
  });
  input.addEventListener('blur', commit);
  return { commit, cancel: () => finish(onCancel) };
}

function startNewFolder() {
  showScreen(current ? 'person' : 'empty');
  const existing = $('people').querySelector('li.draft input');
  if (existing) return existing.focus();
  const input = h('input', { type: 'text', placeholder: 'Folder name, then press Enter', autocomplete: 'off' });
  const li = h('li', { class: 'draft' }, input);
  $('people').prepend(li);
  input.focus();
  inlineEdit(input, {
    onCancel: () => li.remove(),
    onCommit: async (name) => {
      try {
        const p = await window.api.createPerson(name);
        await selectPerson(p.id);
      } catch (e) {
        li.remove();
        showError(e);
      }
    },
  });
}
$('newPerson').addEventListener('click', startNewFolder);
$('emptyNew').addEventListener('click', startNewFolder);

let renameCtl = null; // set while the title is being edited

function endRename() {
  renameCtl = null;
  $('renameInput').hidden = true;
  $('renameHint').hidden = true;
  $('pname').hidden = false;
  $('rename').textContent = 'Rename';
  $('del').textContent = 'Delete';
  $('rename').classList.remove('save');
}

// Keep focus in the input when pressing the buttons, so the click is not preceded by a blur-commit.
['rename', 'del'].forEach((id) => $(id).addEventListener('mousedown', (e) => e.preventDefault()));

$('rename').addEventListener('click', () => {
  if (renameCtl) return renameCtl.commit(); // button now reads "Save"
  const input = $('renameInput');
  input.value = current.name;
  input.hidden = false;
  $('renameHint').hidden = false;
  $('pname').hidden = true;
  $('rename').textContent = 'Save';
  $('del').textContent = 'Cancel';
  $('rename').classList.add('save');
  input.focus();
  input.select();
  renameCtl = inlineEdit(input, {
    onCancel: endRename,
    onCommit: async (name) => {
      try { current = await window.api.renamePerson(current.id, name); } catch (e) { showError(e); }
      endRename();
      renderPerson();
      await refreshPeople();
    },
  });
});

$('del').addEventListener('click', async () => {
  if (renameCtl) return renameCtl.cancel(); // button now reads "Cancel"
  if (!confirm(`Delete "${current.name}" with all its documents and analysis results?`)) return;
  await window.api.deletePerson(current.id);
  current = null;
  store.set('lastPerson', '');
  showScreen('empty');
  await refreshPeople();
});

// ---------- documents ----------
function guessType(name) {
  const n = name.toLowerCase();
  const rules = [
    [/ktp/, 'KTP'],
    [/\bkk\b|kartu.?keluarga/, 'KK'],
    [/passport|paspor/, 'Passport'],
    [/visa/, 'Visa'],
    [/\bsim\b|driver|licen[cs]e/, "Driver's License"],
    [/npwp|tax/, 'NPWP (Tax ID)'],
    [/akta.?lahir|birth/, 'Birth Certificate'],
    [/nikah|marriage|buku.?nikah/, 'Marriage Certificate'],
    [/paklaring|employment|kerja/, 'Employment Letter'],
    [/lamaran|cover|letter/, 'Cover Letter'],
    [/cv|resume/, 'CV'],
    [/ijazah|transkrip|diploma/, 'Diploma'],
    [/sertifikat|certificate|cert\b/, 'Certificate'],
    [/rekening|bank|statement/, 'Bank Statement'],
  ];
  return (rules.find(([re]) => re.test(n)) || [, 'Other'])[1];
}

function showError(e) {
  $('error').textContent = String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  $('error').hidden = false;
}

async function guarded(fn) {
  $('error').hidden = true;
  try { await fn(); } catch (e) { showError(e); }
}

async function addPaths(paths) {
  if (!current || !paths.length) return;
  await guarded(async () => {
    current = await window.api.addDocs(current.id, paths.map((p) => ({ path: p, docType: guessType(p.split(/[\\/]/).pop()) })));
    renderPerson();
    await refreshPeople();
  });
}

$('pick').addEventListener('click', async () => addPaths(await window.api.pickFiles()));

const drop = $('drop');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => addPaths([...e.dataTransfer.files].map((f) => window.api.pathFor(f))));

function renderFiles() {
  $('files').replaceChildren(
    ...current.docs.map((d) => {
      // keep a type stored by an older version selectable
      const types = DOC_TYPES.includes(d.docType) ? DOC_TYPES : [...DOC_TYPES, d.docType];
      const sel = h('select', {}, ...types.map((t) => h('option', t === d.docType ? { selected: '' } : {}, t)));
      sel.addEventListener('change', () => guarded(async () => {
        current = await window.api.setDocType(current.id, d.id, sel.value);
        renderPerson();
        await refreshPeople();
      }));
      const rm = h('button', { class: 'link danger' }, 'Remove');
      rm.addEventListener('click', () => guarded(async () => {
        current = await window.api.removeDoc(current.id, d.id);
        renderPerson();
        await refreshPeople();
      }));
      const ext = (d.name.split('.').pop() || '').toUpperCase().slice(0, 4);
      return h('li', {},
        h('span', { class: 'ext' }, ext),
        h('span', { class: 'name' }, d.name),
        sel,
        h('span', { class: 'doc-state' + (d.extracted ? ' done' : '') }, d.extracted ? '✓ Read' : 'Not read yet'),
        rm);
    })
  );
}

function updateButtons() {
  const ok = current && current.docs.length >= 2 && !busy;
  $('run').disabled = !ok;
  $('rerun').disabled = !ok || !current.docs.some((d) => d.extracted);
}

// ---------- analysis ----------
window.api.onProgress((m) => ($('status').textContent = m));

async function runAnalysis(force) {
  busy = true;
  updateButtons();
  $('error').hidden = true;
  $('status').textContent = 'Starting…';
  try {
    current = await window.api.analyze({ personId: current.id, force });
    $('status').textContent = 'Done.';
    filter = 'all';
    renderPerson();
    showSub('result');
    await refreshPeople();
  } catch (e) {
    showError(e);
    $('status').textContent = '';
    current = await window.api.getPerson(current.id); // partial extractions may already be saved
    renderPerson();
  } finally {
    busy = false;
    updateButtons();
  }
}

$('run').addEventListener('click', () => runAnalysis(false));
$('rerun').addEventListener('click', () => runAnalysis(true));

// ---------- render folder ----------
function renderPerson() {
  $('pname').textContent = current.name;
  renderFiles();
  updateButtons();
  renderResult();
}

function stat(cls, n, label) {
  return h('div', { class: `card stat ${cls}` }, h('div', { class: 'n' }, String(n)), h('div', { class: 'l' }, label));
}

function issueCard(i) {
  return h('div', { class: `card issue ${i.severity}` },
    h('div', { class: 'issue-top' },
      h('h5', {}, i.title),
      h('span', { class: 'tag' }, i.source === 'rule' ? 'RULE' : 'AI'),
      h('span', { class: `pill ${i.severity}` }, SEV_LABEL[i.severity] || i.severity)),
    i.description ? h('p', { class: 'desc' }, i.description) : '',
    h('div', { class: 'evidence' },
      ...(i.evidence || []).map((e) => h('div', { class: 'ev' }, h('span', { class: 'ev-doc' }, e.doc), h('span', { class: 'ev-val' }, e.detail))))
  );
}

function renderResult() {
  const r = current.result;
  const badge = $('badge');
  if (!r) {
    badge.textContent = '';
    badge.className = '';
    $('resultTab').replaceChildren(h('div', { class: 'muted-box' }, 'No results yet. Add at least 2 documents in the Documents tab, then click Analyze.'));
    return;
  }

  const counts = { high: 0, medium: 0, low: 0 };
  r.issues.forEach((i) => (counts[i.severity] = (counts[i.severity] || 0) + 1));
  const total = r.issues.length;
  badge.textContent = total;
  badge.className = 'pill ' + (counts.high ? 'high' : counts.medium ? 'medium' : total ? 'low' : 'ok');

  const head = h('div', { class: 'result-head' },
    h('div', {},
      h('h3', {}, total ? `${total} inconsistenc${total === 1 ? 'y' : 'ies'} found` : 'All documents are consistent'),
      h('p', { class: 'meta' }, `Analyzed ${new Date(r.analyzedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} · ${r.labels.length} documents`),
      h('div', { class: 'chips' }, ...r.labels.map((l) => h('span', { class: 'chip' }, l)))));

  const stats = h('div', { class: 'stats' },
    stat('all', total, 'Total issues'), stat('high', counts.high, 'High'), stat('medium', counts.medium, 'Medium'), stat('low', counts.low, 'Low'));

  // issues list with severity filter
  const list = h('div', {});
  const filters = h('div', { class: 'filters' });
  const drawIssues = () => {
    filters.replaceChildren(...['all', 'high', 'medium', 'low'].map((f) => {
      const b = h('button', f === filter ? { class: 'on' } : {}, f === 'all' ? 'All' : SEV_LABEL[f]);
      b.addEventListener('click', () => { filter = f; drawIssues(); });
      return b;
    }));
    const shown = r.issues.filter((i) => filter === 'all' || i.severity === filter);
    list.replaceChildren(...(shown.length ? shown.map(issueCard) : [h('div', { class: 'empty-ok' }, total ? 'No issues with this severity.' : 'No inconsistencies were found between these documents.')]));
  };
  drawIssues();

  const table = h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Field'), ...r.labels.map((l) => h('th', {}, l)))),
    h('tbody', {}, ...r.matrix.flatMap((row, i) => {
      const mark = h('span', { class: `mark ${row.status}` }, row.status === 'ok' ? '✓' : row.status === 'mismatch' ? '≠' : '·');
      const tr = h('tr', {}, h('td', {}, mark, row.label),
        ...r.labels.map((l) => {
          const v = row.values[l];
          if (!v) return h('td', { class: 'empty' }, '—');
          return h('td', { class: row.status === 'mismatch' ? 'diff' : 'same' }, v);
        }));
      const startsDocGroup = row.group === 'document' && (i === 0 || r.matrix[i - 1].group !== 'document');
      return startsDocGroup
        ? [h('tr', { class: 'group' }, h('td', { colspan: String(r.labels.length + 1) }, 'Document-specific details (not compared across documents)')), tr]
        : [tr];
    }))));

  $('resultTab').replaceChildren(
    head,
    current.stale ? h('div', { class: 'stale' }, 'Documents changed since the last analysis. Click Analyze again to refresh these results.') : '',
    stats,
    h('div', { class: 'section-title' }, h('h4', {}, 'Issues'), filters),
    list,
    h('div', { class: 'section-title' }, h('h4', {}, 'Field comparison')),
    table,
    h('div', { class: 'legend' }, h('span', {}, '✓ match'), h('span', {}, '≠ mismatch'), h('span', {}, '· only one document, or document-specific'), h('span', {}, '— not found'))
  );
}

// ---------- settings ----------
let cfg;
function showProvider() {
  const p = $('provider').value;
  $('model').value = cfg.models[p];
  $('key').value = '';
  $('keyState').textContent = cfg.hasKey[p] ? '(saved)' : '(not set)';
}

async function loadSettings() {
  cfg = await window.api.getConfig();
  $('provider').value = cfg.provider;
  $('language').value = cfg.language;
  showProvider();
}

$('provider').addEventListener('change', showProvider);

async function save(keys) {
  const p = $('provider').value;
  cfg.models[p] = $('model').value.trim() || cfg.models[p];
  await window.api.saveConfig({ provider: p, language: $('language').value, models: cfg.models, keys });
  await loadSettings();
  $('saved').textContent = 'Saved.';
  setTimeout(() => ($('saved').textContent = ''), 2000);
}

$('save').addEventListener('click', () => save($('key').value ? { [$('provider').value]: $('key').value } : {}));
$('clearKey').addEventListener('click', () => save({ [$('provider').value]: '' }));

// ---------- start ----------
(async () => {
  await loadSettings();
  await refreshPeople();
  const last = store.get('lastPerson');
  const target = people.find((p) => p.id === last) || people[0];
  if (target) await selectPerson(target.id);
  else showScreen('empty');
})();
