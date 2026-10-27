// Penyimpanan lokal: <root>/<personId>/person.json + <root>/<personId>/files/*
// One folder = one subject. Kept separate from electron so it can be tested.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID = /^[0-9a-f-]{36}$/;
// Document types saved before the UI was translated to English.
const LEGACY_TYPES = { Lainnya: 'Other', 'Surat Lamaran': 'Cover Letter', Ijazah: 'Diploma' };
const EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.gif'];

function createStore(root) {
  const dir = (id) => {
    if (typeof id !== 'string' || !ID.test(id)) throw new Error('Invalid ID');
    return path.join(root, id);
  };
  const jsonPath = (id) => path.join(dir(id), 'person.json');
  const read = (id) => {
    const p = JSON.parse(fs.readFileSync(jsonPath(id), 'utf8'));
    for (const d of p.docs) d.docType = LEGACY_TYPES[d.docType] || d.docType;
    return p;
  };
  const write = (p) => {
    fs.mkdirSync(path.join(dir(p.id), 'files'), { recursive: true });
    const f = jsonPath(p.id);
    fs.writeFileSync(f + '.tmp', JSON.stringify(p, null, 2), { mode: 0o600 });
    fs.renameSync(f + '.tmp', f);
  };

  const signature = (p) => p.docs.map((d) => `${d.id}:${d.docType}`).join('|');

  // Shape sent to the UI: without raw extraction contents.
  const view = (p) => ({
    id: p.id,
    name: p.name,
    docs: p.docs.map(({ extraction, ...d }) => ({ ...d, extracted: !!extraction })),
    result: p.result || null,
    stale: !!p.result && p.result.signature !== signature(p),
  });

  const mutate = (id, fn) => {
    const p = read(id);
    fn(p);
    write(p);
    return view(p);
  };

  return {
    signature,

    list() {
      if (!fs.existsSync(root)) return [];
      const out = [];
      for (const id of fs.readdirSync(root)) {
        if (!ID.test(id) || !fs.existsSync(jsonPath(id))) continue;
        const v = view(read(id));
        out.push({
          id: v.id,
          name: v.name,
          docCount: v.docs.length,
          issueCount: v.result ? v.result.issues.length : null,
          stale: v.stale,
        });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name, 'id'));
    },

    create(name) {
      name = String(name || '').trim();
      if (!name) throw new Error('Name cannot be empty');
      const p = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString(), docs: [], result: null };
      write(p);
      return view(p);
    },

    get: (id) => view(read(id)),
    getRaw: (id) => read(id),
    filePath: (id, doc) => path.join(dir(id), 'files', doc.file),

    rename: (id, name) =>
      mutate(id, (p) => {
        name = String(name || '').trim();
        if (!name) throw new Error('Name cannot be empty');
        p.name = name;
      }),

    remove(id) {
      fs.rmSync(dir(id), { recursive: true, force: true });
    },

    addDocs: (id, items) =>
      mutate(id, (p) => {
        for (const { path: src, docType } of items) {
          const ext = path.extname(src).toLowerCase();
          if (!EXTS.includes(ext)) throw new Error(`Unsupported format: ${path.basename(src)} (use PDF/PNG/JPG/WEBP)`);
          const docId = crypto.randomUUID();
          const file = docId + ext;
          fs.mkdirSync(path.join(dir(id), 'files'), { recursive: true });
          fs.copyFileSync(src, path.join(dir(id), 'files', file));
          p.docs.push({ id: docId, name: path.basename(src), docType: String(docType || 'Other').slice(0, 40), file, extraction: null, addedAt: new Date().toISOString() });
        }
      }),

    removeDoc: (id, docId) =>
      mutate(id, (p) => {
        const d = p.docs.find((x) => x.id === docId);
        if (!d) return;
        fs.rmSync(path.join(dir(id), 'files', d.file), { force: true });
        p.docs = p.docs.filter((x) => x !== d);
      }),

    // Document type affects the extraction prompt, so the old extraction is discarded.
    setDocType: (id, docId, docType) =>
      mutate(id, (p) => {
        const d = p.docs.find((x) => x.id === docId);
        if (d && d.docType !== docType) {
          d.docType = String(docType).slice(0, 40);
          d.extraction = null;
        }
      }),

    saveExtraction: (id, docId, data) =>
      mutate(id, (p) => {
        const d = p.docs.find((x) => x.id === docId);
        if (d) d.extraction = data;
      }),

    saveResult: (id, result, sig) =>
      mutate(id, (p) => {
        p.result = { ...result, signature: sig, analyzedAt: new Date().toISOString() };
      }),
  };
}

module.exports = { createStore };
