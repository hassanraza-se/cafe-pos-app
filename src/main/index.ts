import 'dotenv/config'; // Load .env first
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import started from 'electron-squirrel-startup';
import { LicenseHandler } from './license-handler';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Disable sandbox for AppImage compatibility
if (process.env.APPIMAGE) {
  app.commandLine.appendSwitch('no-sandbox');
}

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;
const BACKEND_PORT = process.env.BACKEND_PORT || 3000;
const licenseHandler = new LicenseHandler();

// Determine if running in development or production
const isDev = process.env.APP_NODE_ENV === 'development' || !app.isPackaged;
// const isDev = false;

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false, // Don't show until ready
    backgroundColor: '#ffffff',
  });

  // Remove menu bar
  mainWindow.setMenuBarVisibility(false);

  // Load the app
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools(); // Open DevTools in dev mode
  } else {
    mainWindow.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

// Start NestJS backend server
function startBackend(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const backendPath = isDev
        ? path.join(__dirname, '../../api/dist/main.js') // Dev mode
        : path.join(process.resourcesPath, 'api/dist/main.js'); // Production

    console.log('Starting backend from:', backendPath);

    // Check if backend exists
    if (!fs.existsSync(backendPath)) {
      console.error('Backend file not found at:', backendPath);
      reject(new Error('Backend not found'));
      return;
    }

    // Set environment variables for backend
    const dbDir = isDev
        ? path.join(__dirname, '../../database')
        : path.join(process.resourcesPath, 'database');

    const sqliteDbPath = path.join(dbDir, 'pos.db');

    const env = {
      ...process.env,
      PORT: BACKEND_PORT.toString(),
      NODE_ENV: isDev ? 'development' : 'production',
      DB_DIR: dbDir,
      SQLITE_DATABASE: sqliteDbPath,
    };

    // Start the backend process
    backendProcess = spawn('node', [backendPath], {
      env,
      cwd: isDev ? path.join(__dirname, '../../api') : process.resourcesPath,
      stdio: 'inherit', // Show backend logs in console
    });

    backendProcess.on('error', (error) => {
      console.error('Backend process error:', error);
      reject(error);
    });

    backendProcess.on('exit', (code) => {
      console.log(`Backend process exited with code ${code}`);
      if (code !== 0 && code !== null) {
        reject(new Error(`Backend exited with code ${code}`));
      }
    });

    // Wait a bit for backend to start
    setTimeout(() => {
      console.log('Backend started successfully');
      resolve();
    }, 2000);
  });
}

// Stop backend server
function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend...');
    backendProcess.kill();
    backendProcess = null;
  }
}

// App lifecycle
app.whenReady().then(async () => {
  try {
    // Check license on startup
    const licenseValid = await licenseHandler.verifyLicense();

    if (!licenseValid.valid && !isDev) {
      console.warn('License validation failed:', licenseValid.message);
      // Don't block startup, but user will see license screen in app
    }

    // Start backend first (only in production or if backend is built in dev)
    if (!isDev) {
      const backendPath = path.join(process.resourcesPath, 'api/dist/main.js');
      if (fs.existsSync(backendPath)) {
        console.log('Starting backend...');
        await startBackend();
      } else {
        console.warn('Backend not found, running without backend server');
        console.warn('Expected backend at:', backendPath);
      }
    } else {
      console.log('Development mode: Backend should be started manually with "npm run api:dev"');
    }

    // Create window
    createWindow();

    // Handle window activation (macOS)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error: any) {
    console.error('Failed to start application:', error);
    console.error('Error details:', error.message);
    console.error('Stack:', error.stack);

    // Show error dialog
    dialog.showErrorBox(
        'Startup Error',
        `Failed to start application:\n${error.message}\n\nThe app will continue but some features may not work.`
    );

    // Still create window so user can see the app
    createWindow();
  }
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopBackend();
    app.quit();
  }
});

// Clean up on quit
app.on('before-quit', () => {
  stopBackend();
});

// IPC Handlers
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-app-path', () => {
  return app.getPath('userData');
});

ipcMain.handle('backend-url', () => {
  return `http://localhost:${BACKEND_PORT}`;
});

ipcMain.handle('is-dev', () => {
  return isDev;
});

// License activation handler
ipcMain.handle('activate-license', async (event, licenseKey: string) => {
  try {
    const result = await licenseHandler.activateLicense(licenseKey);
    return result;
  } catch (error: any) {
    console.error('License activation error:', error);
    return { success: false, message: 'Failed to activate license' };
  }
});

// Get license info
ipcMain.handle('get-license-info', async () => {
  return licenseHandler.getLicenseInfo();
});

// Validate license
ipcMain.handle('validate-license', async () => {
  return licenseHandler.verifyLicense();
});

// Check feature
ipcMain.handle('has-feature', async (event, feature: string) => {
  return licenseHandler.hasFeature(feature);
});

// Deactivate license
ipcMain.handle('deactivate-license', async () => {
  await licenseHandler.deactivateLicense();
  return { success: true };
});

// File dialog handler
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openFile'],
  });
  return result.filePaths;
});

// Show error dialog
ipcMain.handle('show-error', async (event, title: string, message: string) => {
  dialog.showErrorBox(title, message);
});

// Show info dialog
ipcMain.handle('show-info', async (event, title: string, message: string) => {
  await dialog.showMessageBox(mainWindow!, {
    type: 'info',
    title,
    message,
    buttons: ['OK'],
  });
});

// Handle unhandled errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  dialog.showErrorBox('Application Error', error.message);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});