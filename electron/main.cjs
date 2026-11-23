const { app, BrowserWindow, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

// Required on Windows so Taskbar & JumpList use our custom PAAS WIVER icon
if (process.platform === 'win32') {
  app.setAppUserModelId('com.paaswiver.app');
}

// Reliability & low-end PC flags:
// - no-sandbox / disable-gpu-sandbox prevent silent startup failures from %TEMP% portable extraction or restricted folders
// - disable-background-timer-throttling keeps toolpath simulation smooth
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let mainWindow = null;

function resolveAppIcon() {
  const candidates = [
    path.join(process.resourcesPath || '', 'app_icon', 'icon.ico'),
    path.join(process.resourcesPath || '', 'app_icon', 'icon.png'),
    path.join(__dirname, '..', 'app_icon', 'icon.ico'),
    path.join(__dirname, '..', 'app_icon', 'icon.png'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function createWindow() {
  const iconPath = resolveAppIcon();

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 820,
    minWidth: 1024,
    minHeight: 660,
    title: 'PAAS WIVER',
    backgroundColor: '#0B0F17',
    icon: iconPath,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  // Clean shop-floor viewport without Chromium menu bar
  Menu.setApplicationMenu(null);

  const distHtml = path.join(__dirname, '..', 'dist', 'index.html');
  if (!fs.existsSync(distHtml)) {
    dialog.showErrorBox(
      'PAAS WIVER — Missing App Bundle',
      `Could not find built UI at:\n${distHtml}\n\nNote: If you copied win-unpacked\\PAAS WIVER.exe alone to the Desktop, copy PAAS-WIVER-Portable.exe instead or use a Desktop Shortcut.`
    );
    app.quit();
    return;
  }

  let shown = false;
  const showNow = () => {
    if (shown || !mainWindow || mainWindow.isDestroyed()) return;
    shown = true;
    if (iconPath && process.platform === 'win32') {
      mainWindow.setIcon(iconPath);
    }
    mainWindow.show();
    mainWindow.focus();
  };

  mainWindow.once('ready-to-show', showNow);
  // Fallback timer in case slow integrated graphics delay ready-to-show
  setTimeout(showNow, 1500);

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    showNow();
    dialog.showErrorBox(
      'PAAS WIVER — Load Error',
      `Failed to load toolpath viewer (${errorCode}): ${errorDescription}`
    );
  });

  mainWindow.loadFile(distHtml).catch((err) => {
    dialog.showErrorBox('PAAS WIVER — Startup Error', String(err));
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

process.on('uncaughtException', (err) => {
  dialog.showErrorBox('PAAS WIVER — Unexpected Error', err ? String(err.stack || err) : 'Unknown error');
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
