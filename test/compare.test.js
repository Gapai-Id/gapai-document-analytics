const assert = require('assert');
const { compareFields } = require('../src/compare');

const f = (key, value, type = 'text', scope = 'person') => ({ key, label: key, value, type, scope });

// identity documents: same keys, one typo
{
  const { issues, matrix } = compareFields([
    { label: 'CV', data: { fields: [f('full_name', 'Agung', 'name'), f('nik', '3201', 'id'), f('address', 'Jl. Mawar No. 1', 'address')] } },
    { label: 'KK', data: { fields: [f('full_name', 'Agunk', 'name'), f('nik', '3201', 'id'), f('address', 'Jl Mawar no 1', 'address')] } },
    { label: 'KTP', data: { fields: [f('full_name', 'Agung', 'name'), f('nik', '3201', 'id')] } },
  ]);
  const name = issues.find((i) => i.field === 'full_name');
  assert(name, 'name typo must be detected');
  assert.strictEqual(name.severity, 'medium');
  assert(name.evidence.some((e) => e.doc === 'KK' && e.detail === 'Agunk'));
  assert(!issues.find((i) => i.field === 'nik'), 'identical NIK must not be an issue');
  assert(!issues.find((i) => i.field === 'address'), 'punctuation/case difference is not an issue');
  assert.strictEqual(matrix.find((r) => r.key === 'nik').status, 'ok');
  assert.strictEqual(matrix[0].key, 'full_name', 'known keys come first, in order');
}

// dynamic fields: certificates have no NIK, so no NIK row appears at all
{
  const { issues, matrix } = compareFields([
    { label: 'Cert A', data: { fields: [f('full_name', 'Agung', 'name'), f('certificate_title', 'Cooking Basics', 'text', 'document'), f('issue_date', '2020-01-01', 'date', 'document')] } },
    { label: 'Cert B', data: { fields: [f('full_name', 'Agung', 'name'), f('certificate_title', 'Food Safety', 'text', 'document'), f('issue_date', '2021-05-05', 'date', 'document')] } },
  ]);
  assert.deepStrictEqual(matrix.map((r) => r.key).sort(), ['certificate_title', 'full_name', 'issue_date']);
  assert.strictEqual(issues.length, 0, 'document-specific fields must never be flagged');
  assert.strictEqual(matrix.find((r) => r.key === 'certificate_title').status, 'info');
  assert.strictEqual(matrix[matrix.length - 1].group, 'document');
}

// person-scope custom field that differs IS flagged
{
  const { issues } = compareFields([
    { label: 'A', data: { fields: [f('license_number', 'X-100', 'id')] } },
    { label: 'B', data: { fields: [f('license_number', 'X-101', 'id')] } },
  ]);
  assert.strictEqual(issues[0].severity, 'high');
}

// token subset, and old (pre-dynamic) extractions still work
{
  const sub = compareFields([
    { label: 'A', data: { full_name: 'Agung' } },
    { label: 'B', data: { full_name: 'Agung Prasetyo' } },
  ]).issues[0];
  assert.strictEqual(sub.severity, 'low');
}

// Indonesian result language
{
  const { issues } = compareFields([
    { label: 'A', data: { fields: [f('nik', '1', 'id')] } },
    { label: 'B', data: { fields: [f('nik', '2', 'id')] } },
  ], 'id');
  assert.strictEqual(issues[0].title, 'NIK tidak konsisten');
}

console.log('compare tests passed');
