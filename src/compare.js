// Deterministic comparison of extracted fields. No AI involved, so no hallucination.
// Fields are dynamic: whatever the AI found in the documents, grouped by canonical key.

// Preferred order for well-known keys; everything else follows in order of appearance.
const KNOWN_ORDER = ['full_name', 'nik', 'birth_place', 'birth_date', 'gender', 'address', 'religion', 'marital_status', 'nationality', 'occupation', 'email', 'phone', 'father_name', 'mother_name'];

// Text shown in the results, per result language.
const STRINGS = {
  en: {
    fields: { full_name: 'Full name', nik: 'National ID (NIK)', birth_place: 'Place of birth', birth_date: 'Date of birth', gender: 'Gender', address: 'Address', religion: 'Religion', marital_status: 'Marital status', nationality: 'Nationality', occupation: 'Occupation', email: 'Email', phone: 'Phone', father_name: "Father's name", mother_name: "Mother's name" },
    inconsistent: (l) => `${l} is inconsistent`,
    differ: 'Values differ',
    addrSimilar: 'Addresses look similar, probably a formatting difference',
    addrDiffer: 'Addresses differ',
    subset: 'One value is shorter / more complete than the other',
    typo: 'Very similar, likely a typo',
    farApart: 'Values differ significantly',
  },
  id: {
    fields: { full_name: 'Nama lengkap', nik: 'NIK', birth_place: 'Tempat lahir', birth_date: 'Tanggal lahir', gender: 'Jenis kelamin', address: 'Alamat', religion: 'Agama', marital_status: 'Status perkawinan', nationality: 'Kewarganegaraan', occupation: 'Pekerjaan', email: 'Email', phone: 'Telepon', father_name: 'Nama ayah', mother_name: 'Nama ibu' },
    inconsistent: (l) => `${l} tidak konsisten`,
    differ: 'Nilai berbeda',
    addrSimilar: 'Alamat mirip, kemungkinan beda penulisan',
    addrDiffer: 'Alamat berbeda',
    subset: 'Salah satu lebih singkat/lengkap',
    typo: 'Sangat mirip, kemungkinan typo',
    farApart: 'Nilai berbeda jauh',
  },
};

// How a field type is compared: identifiers/dates/numbers must match exactly.
const MODE = { id: 'id', date: 'id', number: 'id', name: 'text', text: 'text', address: 'address' };

// Extractions saved by the first version had fixed top-level fields; convert them.
const LEGACY = { full_name: 'name', nik: 'id', birth_place: 'text', birth_date: 'date', gender: 'text', address: 'address', religion: 'text', marital_status: 'text', nationality: 'text' };
function normalizeExtraction(data) {
  if (Array.isArray(data.fields)) return data;
  const fields = Object.entries(LEGACY)
    .filter(([k]) => data[k])
    .map(([k, type]) => ({ key: k, label: k, value: String(data[k]), type, scope: 'person' }));
  return { ...data, fields };
}

function normText(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normId(s) {
  return normText(s).replace(/\s+/g, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

function similarity(a, b) {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 1 : 1 - levenshtein(a, b) / max;
}

// "agung" vs "agung prasetyo": every word of the shorter value appears in the longer one
function isTokenSubset(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const longTokens = new Set(long.split(' '));
  return short.split(' ').every((t) => longTokens.has(t));
}

function severityFor(mode, a, b, t) {
  const sim = similarity(a, b);
  if (mode === 'id') return { severity: 'high', note: t.differ };
  if (mode === 'address') {
    return sim >= 0.6
      ? { severity: 'low', note: t.addrSimilar }
      : { severity: 'medium', note: t.addrDiffer };
  }
  if (isTokenSubset(a, b)) return { severity: 'low', note: t.subset };
  if (sim >= 0.8) return { severity: 'medium', note: t.typo };
  return { severity: 'high', note: t.farApart };
}

const RANK = { high: 3, medium: 2, low: 1 };
const prettyKey = (k) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

/**
 * @param {{label: string, data: object}[]} docs  extraction result per document
 * @param {'en'|'id'} lang result language
 * @returns {{matrix: object[], issues: object[]}}
 */
function compareFields(docs, lang = 'en') {
  const t = STRINGS[lang] || STRINGS.en;
  const fieldsByDoc = docs.map((d) => normalizeExtraction(d.data || {}).fields.filter((f) => f && f.key && f.value != null && String(f.value).trim() !== ''));

  // union of keys, in order of first appearance
  const meta = new Map(); // key -> {label, type, scope}
  for (const fields of fieldsByDoc) {
    for (const f of fields) {
      const m = meta.get(f.key);
      if (!m) meta.set(f.key, { label: f.label, type: f.type, scope: f.scope });
      else if (f.scope === 'document') m.scope = 'document'; // document-specific in any doc => never flagged
    }
  }
  const keys = [...meta.keys()].sort((a, b) => {
    const ia = KNOWN_ORDER.indexOf(a), ib = KNOWN_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  const matrix = [];
  const issues = [];

  for (const key of keys) {
    const m = meta.get(key);
    const mode = MODE[m.type] || 'text';
    const label = t.fields[key] || m.label || prettyKey(key);
    const group = m.scope === 'document' ? 'document' : 'person';
    const row = { key, label, group, values: {} };
    const present = [];

    docs.forEach((d, i) => {
      const f = fieldsByDoc[i].find((x) => x.key === key);
      row.values[d.label] = f ? String(f.value) : null;
      if (f) present.push({ doc: d.label, value: String(f.value), norm: mode === 'id' ? normId(f.value) : normText(f.value) });
    });

    const distinct = [...new Set(present.map((p) => p.norm))];
    row.status = group === 'document' ? 'info' : present.length < 2 ? 'single' : distinct.length === 1 ? 'ok' : 'mismatch';
    matrix.push(row);

    if (row.status !== 'mismatch') continue;

    // the worst pair decides the issue severity
    let worst = { severity: 'low', note: '' };
    for (let i = 0; i < distinct.length; i++) {
      for (let j = i + 1; j < distinct.length; j++) {
        const s = severityFor(mode, distinct[i], distinct[j], t);
        if (RANK[s.severity] >= RANK[worst.severity]) worst = s;
      }
    }
    issues.push({
      source: 'rule',
      field: key,
      title: t.inconsistent(label),
      severity: worst.severity,
      description: worst.note,
      evidence: present.map((p) => ({ doc: p.doc, detail: p.value })),
    });
  }

  // person fields first, document-specific ones after
  matrix.sort((a, b) => (a.group === b.group ? 0 : a.group === 'person' ? -1 : 1));
  issues.sort((a, b) => RANK[b.severity] - RANK[a.severity]);
  return { matrix, issues };
}

module.exports = { compareFields, normalizeExtraction, STRINGS, similarity, normText };
