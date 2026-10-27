const { askJson } = require('./llm');
const { compareFields, normalizeExtraction } = require('./compare');

const SYSTEM = 'You are a document verification assistant. Reply with ONLY one valid JSON object, no other text. Never invent data: if something is not visible in the document, use null.';

const EXTRACT_PROMPT = (docType) => `This document is of type "${docType}". Extract its data exactly as written (do NOT fix typos that appear in the document; keep names, places and addresses in their original language).

Return JSON of this shape:
{
  "doc_summary": string,
  "fields": [{"key": string, "label": string, "value": string, "type": "name"|"id"|"date"|"number"|"address"|"text", "scope": "person"|"document"}],
  "work_history": [{"company": string, "title": string, "start": string|null, "end": string|null, "details": string|null}],
  "education": [{"institution": string, "level_or_major": string|null, "start": string|null, "end": string|null}],
  "skills_and_certifications": [string],
  "other_facts": [string],
  "observations": [string]
}

Rules for "fields":
- Extract EVERY meaningful field printed on this document. Do not limit yourself to examples: an ID card has NIK, name, etc.; a certificate has holder, title, issuer, dates, certificate number; a CV has contact details, and so on.
- "scope": "person" for facts about the person that should be identical in every document (name, ID number, birth date, gender, address, religion, marital status, nationality, email, phone, parents' names, ...). "document" for facts specific to this document (certificate title/number/issuer/issue date, validity period, document number, letter date, position applied for, ...).
- "key": snake_case English. Use these standard keys whenever they apply: full_name, nik, birth_place, birth_date, gender, address, religion, marital_status, nationality, occupation, email, phone, father_name, mother_name. For anything else invent a short descriptive key. The SAME real-world fact must always get the SAME key, whatever the document calls it.
- "label": short human-readable English name. "value": the value as written, except dates: use YYYY-MM-DD when the full date is known, and gender: "Male" or "Female".
- "type": "id" for identifier numbers, "date" for dates, "number" for other numbers, "name" for person/organization names, "address" for addresses, "text" otherwise.
Other keys:
- "other_facts": other important facts that do not fit as a field.
- "observations": oddities INSIDE this document itself (e.g. impossible dates, name differing between sections, blurry/unreadable parts).
Use empty arrays when there is nothing.`;

const LANG_NAME = { en: 'English', id: 'Indonesian (Bahasa Indonesia)' };
const ANOMALY = { en: (l) => `Anomaly in ${l}`, id: (l) => `Kejanggalan di ${l}` };

const SEMANTIC_PROMPT = (extractions, lang) => `Below are extraction results from several documents belonging to ONE person:

${JSON.stringify(extractions, null, 2)}

Fields that share the same key across documents are already compared by another program, so do NOT report differences between those again. DO report when fields with DIFFERENT keys clearly describe the same thing and conflict, and facts that are missing where they should appear.

Look for other inconsistencies:
1. Information present in one document that should also appear (but is missing) in another, e.g. work experience, job titles, education, certifications.
2. Conflicts: different companies/titles/work periods, different education history, impossible timelines, overlapping dates, age that does not fit the history.
3. Oddities inside a single document (see "observations" and other data).
4. Differences in family facts (parents, spouse, children) between documents.

Do not report things that are normal (e.g. an ID card naturally has no work history). Only report with a strong reason.

Kembalikan JSON:
{"issues":[{"title": string, "severity": "high"|"medium"|"low", "description": string, "evidence":[{"doc": "<document label exactly as given above>", "detail": string}]}]}
Write all text values in ${LANG_NAME[lang]}. If there are no problems, return {"issues": []}.`;

/**
 * @param {{id: string, label: string, path: string, docType: string, extraction: object|null}[]} files
 * @param {{provider: string, key: string, model: string, lang: 'en'|'id'}} cfg
 * @param {(msg: string) => void} progress
 * @param {(docId: string, data: object) => void} onExtracted called after each document is read (for caching)
 * @param {boolean} force re-read even if a stored extraction exists
 */
async function analyze(files, cfg, progress, onExtracted, force = false) {
  const lang = cfg.lang === 'id' ? 'id' : 'en';
  const extractions = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    let data = !force && f.extraction;
    if (!data) {
      progress(`Reading document ${i + 1}/${files.length}: ${f.label}`);
      data = await askJson({ ...cfg, system: SYSTEM, prompt: EXTRACT_PROMPT(f.docType), filePath: f.path });
      onExtracted(f.id, data);
    }
    extractions.push({ label: f.label, data: normalizeExtraction(data) });
  }

  progress('Comparing core fields…');
  const { matrix, issues } = compareFields(extractions, lang);

  // per-document internal observations become issues directly
  for (const e of extractions) {
    for (const o of e.data.observations || []) {
      issues.push({ source: 'ai', title: ANOMALY[lang](e.label), severity: 'medium', description: o, evidence: [{ doc: e.label, detail: o }] });
    }
  }

  if (extractions.length >= 2) {
    progress('Comparing contents across documents with AI…');
    const slim = extractions.map((e) => ({
      label: e.label,
      summary: e.data.doc_summary,
      fields: Object.fromEntries((e.data.fields || []).map((f) => [f.key, f.value])),
      work_history: e.data.work_history,
      education: e.data.education,
      skills_and_certifications: e.data.skills_and_certifications,
      other_facts: e.data.other_facts,
    }));
    const res = await askJson({ ...cfg, system: SYSTEM, prompt: SEMANTIC_PROMPT(slim, lang) });
    for (const i of res.issues || []) issues.push({ source: 'ai', ...i });
  }

  const rank = { high: 3, medium: 2, low: 1 };
  issues.sort((a, b) => (rank[b.severity] || 0) - (rank[a.severity] || 0));
  return { labels: extractions.map((e) => e.label), matrix, issues, extractions };
}

module.exports = { analyze };
