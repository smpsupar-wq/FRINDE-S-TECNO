const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('paasWiverDesktop', {
  platform: process.platform,
});
