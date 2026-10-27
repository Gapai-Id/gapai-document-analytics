// Thin adapter for Claude and OpenAI. Uses fetch directly, no SDK.

const fs = require('fs');
const path = require('path');

const MIME = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function loadFile(filePath) {
  const mime = MIME[path.extname(filePath).toLowerCase()];
  if (!mime) throw new Error(`Unsupported file format: ${path.basename(filePath)} (use PDF/PNG/JPG/WEBP)`);
  return { name: path.basename(filePath), mime, b64: fs.readFileSync(filePath).toString('base64') };
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Model response is not JSON:\n' + text.slice(0, 300));
  return JSON.parse(text.slice(start, end + 1));
}

async function post(url, headers, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = JSON.parse(text).error?.message || text; } catch {}
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return JSON.parse(text);
}

async function callClaude({ key, model, system, prompt, file }) {
  const content = [];
  if (file) {
    content.push(
      file.mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: file.mime, data: file.b64 } }
        : { type: 'image', source: { type: 'base64', media_type: file.mime, data: file.b64 } }
    );
  }
  content.push({ type: 'text', text: prompt });
  const data = await post(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: 4096, system, messages: [{ role: 'user', content }] }
  );
  return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
}

async function callOpenAI({ key, model, system, prompt, file }) {
  const content = [];
  if (file) {
    content.push(
      file.mime === 'application/pdf'
        ? { type: 'file', file: { filename: file.name, file_data: `data:${file.mime};base64,${file.b64}` } }
        : { type: 'image_url', image_url: { url: `data:${file.mime};base64,${file.b64}` } }
    );
  }
  content.push({ type: 'text', text: prompt });
  const data = await post(
    'https://api.openai.com/v1/chat/completions',
    { authorization: `Bearer ${key}` },
    {
      model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
    }
  );
  return data.choices[0].message.content;
}

/** Call the model and return the parsed JSON object. */
async function askJson({ provider, key, model, system, prompt, filePath }) {
  const file = filePath ? loadFile(filePath) : null;
  const fn = provider === 'openai' ? callOpenAI : callClaude;
  const text = await fn({ key, model, system, prompt, file });
  return extractJson(text);
}

module.exports = { askJson };
