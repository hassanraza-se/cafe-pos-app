import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
    // App info
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    getAppPath: () => ipcRenderer.invoke('get-app-path'),
    getBackendUrl: () => ipcRenderer.invoke('backend-url'),
    // isDev: () => ipcRenderer.invoke('is-dev'), // Add this as a function

    // License management
    activateLicense: (licenseKey: string) =>
        ipcRenderer.invoke('activate-license', licenseKey),
    getLicenseInfo: () =>
        ipcRenderer.invoke('get-license-info'),
    validateLicense: () =>
        ipcRenderer.invoke('validate-license'),
    hasFeature: (feature: string) =>
        ipcRenderer.invoke('has-feature', feature),
    deactivateLicense: () =>
        ipcRenderer.invoke('deactivate-license'),

    // File operations
    openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

    // Dialogs
    showError: (title: string, message: string) =>
        ipcRenderer.invoke('show-error', title, message),
    showInfo: (title: string, message: string) =>
        ipcRenderer.invoke('show-info', title, message),

    // Platform info
    platform: process.platform,

    // Environment
    isDev: process.env.APP_NODE_ENV === 'development',
});

// Type definitions for TypeScript
export interface ElectronAPI {
    getAppVersion: () => Promise<string>;
    getAppPath: () => Promise<string>;
    getBackendUrl: () => Promise<string>;
    activateLicense: (licenseKey: string) => Promise<any>;
    getLicenseInfo: () => Promise<any>;
    validateLicense: () => Promise<any>;
    hasFeature: (feature: string) => Promise<boolean>;
    deactivateLicense: () => Promise<any>;
    openFileDialog: () => Promise<string[]>;
    showError: (title: string, message: string) => Promise<void>;
    showInfo: (title: string, message: string) => Promise<void>;
    platform: string;
    isDev: boolean;
}

declare global {
    interface Window {
        // @ts-ignore
        electronAPI: ElectronAPI;
    }
}