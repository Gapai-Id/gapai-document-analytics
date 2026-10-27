const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dcc-'));
const src = path.join(tmp, 'ktp.png');
fs.writeFileSync(src, 'x');

let s = createStore(path.join(tmp, 'people'));
const p = s.create('Agung');
assert.strictEqual(s.list().length, 1);

let v = s.addDocs(p.id, [{ path: src, docType: 'KTP' }, { path: src, docType: 'KK' }]);
assert.strictEqual(v.docs.length, 2);
assert(!('file' in {}) && v.docs[0].extracted === false);

// data survives a "reopen" (new store, same folder)
s.saveExtraction(p.id, v.docs[0].id, { full_name: 'Agung' });
const sig = s.signature(s.getRaw(p.id));
s.saveResult(p.id, { labels: [], matrix: [], issues: [{}] }, sig);
s = createStore(path.join(tmp, 'people'));
v = s.get(p.id);
assert.strictEqual(v.docs[0].extracted, true);
assert.strictEqual(v.result.issues.length, 1);
assert.strictEqual(v.stale, false);
assert.strictEqual(s.list()[0].issueCount, 1);

// changing doc type -> result becomes stale + extraction discarded
v = s.setDocType(p.id, v.docs[0].id, 'CV');
assert.strictEqual(v.stale, true);
assert.strictEqual(v.docs[0].extracted, false);

// removing a document deletes its physical file
const raw = s.getRaw(p.id);
const stored = s.filePath(p.id, raw.docs[1]);
assert(fs.existsSync(stored));
s.removeDoc(p.id, raw.docs[1].id);
assert(!fs.existsSync(stored));

assert.throws(() => s.get('../../etc'), /Invalid ID/);
assert.throws(() => s.addDocs(p.id, [{ path: path.join(tmp, 'a.exe'), docType: 'x' }]), /Unsupported format/);

// legacy Indonesian document types are shown with the English names
const pj = path.join(tmp, 'people', p.id, 'person.json');
const legacy = JSON.parse(fs.readFileSync(pj, 'utf8'));
legacy.docs[0].docType = 'Lainnya';
fs.writeFileSync(pj, JSON.stringify(legacy));
assert.strictEqual(s.get(p.id).docs[0].docType, 'Other');

s.remove(p.id);
assert.strictEqual(s.list().length, 0);
console.log('store tests passed');
