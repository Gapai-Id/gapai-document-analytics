const { app, BrowserWindow, ipcMain, dialog, safeStorage, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { analyze } = require('./analyze');
const { createStore } = require('./store');

let store;

// The app was renamed; copy data saved under the old app name once, on first start.
function migrateLegacyData() {
  const legacy = path.join(app.getPath('appData'), 'document-consistency-checker');
  const target = app.getPath('userData');
  if (legacy === target || !fs.existsSync(legacy) || fs.existsSync(path.join(target, 'people'))) return;
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(legacy, target, { recursive: true });
}

const DEFAULTS = { provider: 'claude', language: 'en', models: { claude: 'claude-sonnet-5-5', openai: 'gpt-4o' }, keys: {} };
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return { ...DEFAULTS, ...c, models: { ...DEFAULTS.models, ...c.models }, keys: c.keys || {} };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function writeConfig(c) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2), { mode: 0o600 });
}

function encrypt(plain) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is unavailable; the API key was not saved.');
  return safeStorage.encryptString(plain).toString('base64');
}

function decrypt(b64) {
  return safeStorage.decryptString(Buffer.from(b64, 'base64'));
}

// A stored key can become unreadable (e.g. after the app was renamed and the Keychain item changed).
function keyUsable(b64) {
  if (!b64) return false;
  try { decrypt(b64); return true; } catch { return false; }
}

// The renderer never receives the key, only whether one is stored.
ipcMain.handle('config:get', () => {
  const c = readConfig();
  return { provider: c.provider, language: c.language, models: c.models, hasKey: { claude: keyUsable(c.keys.claude), openai: keyUsable(c.keys.openai) } };
});

ipcMain.handle('config:save', (_e, { provider, language, models, keys }) => {
  const c = readConfig();
  c.provider = provider;
  c.language = language === 'id' ? 'id' : 'en';
  c.models = { ...c.models, ...models };
  for (const p of ['claude', 'openai']) {
    if (keys?.[p]) c.keys[p] = encrypt(keys[p].trim());
    if (keys?.[p] === '') delete c.keys[p];
  }
  writeConfig(c);
  return { ok: true };
});

ipcMain.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'gif'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('people:list', () => store.list());
ipcMain.handle('people:create', (_e, name) => store.create(name));
ipcMain.handle('people:get', (_e, id) => store.get(id));
ipcMain.handle('people:rename', (_e, id, name) => store.rename(id, name));
ipcMain.handle('people:delete', (_e, id) => store.remove(id));
ipcMain.handle('docs:add', (_e, id, items) => store.addDocs(id, items));
ipcMain.handle('docs:remove', (_e, id, docId) => store.removeDoc(id, docId));
ipcMain.handle('docs:setType', (_e, id, docId, type) => store.setDocType(id, docId, type));

ipcMain.handle('analyze', async (e, { personId, force }) => {
  const c = readConfig();
  const enc = c.keys[c.provider];
  if (!keyUsable(enc)) throw new Error(`No usable ${c.provider} API key. Open Settings and enter it again.`);
  const cfg = { provider: c.provider, key: decrypt(enc), model: c.models[c.provider], lang: c.language };

  const p = store.getRaw(personId);
  if (p.docs.length < 2) throw new Error('At least 2 documents are required.');
  const sig = store.signature(p);

  const used = new Map();
  const docs = p.docs.map((d) => {
    const base = `${d.docType} (${d.name})`;
    const n = (used.get(base) || 0) + 1;
    used.set(base, n);
    return { id: d.id, label: n > 1 ? `${base} #${n}` : base, path: store.filePath(personId, d), docType: d.docType, extraction: d.extraction };
  });

  const result = await analyze(docs, cfg, (m) => e.sender.send('progress', m), (docId, data) => store.saveExtraction(personId, docId, data), !!force);
  delete result.extractions; // already stored per document
  return store.saveResult(personId, result, sig);
});

migrateLegacyData();

app.whenReady().then(() => {
  // When running from source on macOS the Dock would show the Electron icon; packaged builds use build/icon.png.
  if (process.platform === 'darwin' && !app.isPackaged) app.dock?.setIcon(nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')));
  store = createStore(path.join(app.getPath('userData'), 'people'));
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    show: false,
    icon: path.join(__dirname, 'renderer', 'logo.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => {
    win.maximize(); // fill the whole screen (not native fullscreen, so the menu bar stays)
    win.show();
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
});

app.on('window-all-closed', () => app.quit());
