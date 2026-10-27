const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  getConfig: invoke('config:get'),
  saveConfig: invoke('config:save'),
  pickFiles: invoke('files:pick'),
  pathFor: (file) => webUtils.getPathForFile(file),
  listPeople: invoke('people:list'),
  createPerson: invoke('people:create'),
  getPerson: invoke('people:get'),
  renamePerson: invoke('people:rename'),
  deletePerson: invoke('people:delete'),
  addDocs: invoke('docs:add'),
  removeDoc: invoke('docs:remove'),
  setDocType: invoke('docs:setType'),
  analyze: invoke('analyze'),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, m) => cb(m)),
});
