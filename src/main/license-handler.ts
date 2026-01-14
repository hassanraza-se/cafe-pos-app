import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { app } from 'electron';
import axios from 'axios';

const LICENSE_SERVER = process.env.LICENSE_SERVER_URL || 'http://127.0.0.1:8000/api';
const LICENSE_FILE = path.join(app.getPath('userData'), 'license.dat');
const APP_VERSION = app.getVersion();

interface LicenseInfo {
    license_key: string;
    customer_name: string;
    customer_email: string;
    plan_price: number;
    plan_type: string;
    features: string[];
    expires_at: string;
    days_remaining: number;
    activated_at?: string;
}

interface StoredLicense {
    key: string;
    hardwareId: string;
    licenseInfo: LicenseInfo;
    lastVerified: string;
    activatedAt: string;
}

export class LicenseHandler {
    private storedLicense: StoredLicense | null = null;
    private verificationInterval: NodeJS.Timeout | null = null;

    constructor() {
        this.loadStoredLicense();
        this.startPeriodicVerification();
    }

    // Get unique hardware ID
    private getHardwareId(): string {
        const cpus = os.cpus();
        const networkInterfaces = os.networkInterfaces();

        const cpuModel = cpus[0]?.model || '';
        const hostname = os.hostname();

        // Get first non-internal MAC address
        let mac = '';
        for (const name of Object.keys(networkInterfaces)) {
            const nets = networkInterfaces[name];
            if (nets) {
                for (const net of nets) {
                    if (!net.internal && net.mac !== '00:00:00:00:00:00') {
                        mac = net.mac;
                        break;
                    }
                }
            }
            if (mac) break;
        }

        const combined = `${cpuModel}-${hostname}-${mac}`;
        return crypto.createHash('sha256').update(combined).digest('hex');
    }

    // Get device info
    private getDeviceInfo() {
        return {
            device_name: os.hostname(),
            os_info: `${os.type()} ${os.release()}`,
            app_version: APP_VERSION,
        };
    }

    // Activate license with server
    async activateLicense(licenseKey: string): Promise<{
        valid: boolean;
        message: string;
        data?: any;
    }> {
        try {
            const hardwareId = this.getHardwareId();
            const deviceInfo = this.getDeviceInfo();

            const response = await axios.post(`${LICENSE_SERVER}/license/activate`, {
                license_key: licenseKey,
                hardware_id: hardwareId,
                ...deviceInfo,
            }, {
                timeout: 10000,
            });

            if (response.data.success) {
                // Store license locally
                this.storedLicense = {
                    key: licenseKey,
                    hardwareId: hardwareId,
                    licenseInfo: response.data.data,
                    lastVerified: new Date().toISOString(),
                    activatedAt: new Date().toISOString(),
                };

                this.saveStoredLicense();

                return {
                    valid: true,
                    message: 'License activated successfully',
                    data: response.data.data,
                };
            }

            return {
                valid: false,
                message: response.data.message || 'Activation failed',
            };
        } catch (error: any) {
            console.error('License activation error:', error);

            if (error.response) {
                return {
                    valid: false,
                    message: error.response.data?.message || 'Activation failed',
                };
            }

            return {
                valid: false,
                message: 'Unable to connect to license server. Please check your internet connection.',
            };
        }
    }

    // Verify license with server
    async verifyLicense(silent = false): Promise<{
        valid: boolean;
        message: string;
        info?: any;
    }> {
        // First check local license
        if (!this.storedLicense) {
            return { valid: false, message: 'No license found' };
        }

        // Check hardware binding
        const currentHardwareId = this.getHardwareId();
        if (this.storedLicense.hardwareId !== currentHardwareId) {
            return { valid: false, message: 'License is bound to different hardware' };
        }

        // Check local expiry before server call
        const expiryDate = new Date(this.storedLicense.licenseInfo.expires_at);
        if (expiryDate < new Date()) {
            return { valid: false, message: 'License has expired' };
        }

        // Verify with server (if online)
        try {
            const response = await axios.post(`${LICENSE_SERVER}/license/verify`, {
                license_key: this.storedLicense.key,
                hardware_id: currentHardwareId,
                app_version: APP_VERSION,
            }, {
                timeout: 5000,
            });

            if (response.data.success) {
                // Update local cache with server data
                this.storedLicense.licenseInfo = response.data.data;
                this.storedLicense.lastVerified = new Date().toISOString();
                this.saveStoredLicense();

                return {
                    valid: true,
                    message: 'License is valid',
                    info: response.data.data,
                };
            }

            // Server says invalid
            if (!silent) {
                await this.deactivateLicense();
            }

            return {
                valid: false,
                message: response.data.message || 'License verification failed',
            };
        } catch (error: any) {
            console.error('License verification error:', error);

            // if license expired or deactivated or invalid
            if (error.response?.status === 404 && error.response?.data?.code === "INVALID") {
                return {
                    valid: false,
                    message: error.response?.data?.message || "Invalid license"
                }
            }

            // If offline, use cached license data
            const lastVerified = new Date(this.storedLicense.lastVerified);
            const hoursSinceVerification = (Date.now() - lastVerified.getTime()) / (1000 * 60 * 60);

            // Allow 72 hours offline grace period
            if (hoursSinceVerification < 72) {
                return {
                    valid: true,
                    message: 'License valid (offline mode)',
                    info: this.storedLicense.licenseInfo,
                };
            }

            return {
                valid: false,
                message: 'Unable to verify license. Please connect to the internet.',
            };
        }
    }

    // Deactivate license
    async deactivateLicense(): Promise<{
        success: boolean;
        message: string;
    }> {
        if (!this.storedLicense) {
            return { success: false, message: 'No license found' };
        }

        try {
            // Notify server
            await axios.post(`${LICENSE_SERVER}/license/deactivate`, {
                license_key: this.storedLicense.key,
                hardware_id: this.getHardwareId(),
            }, {
                timeout: 5000,
            });
        } catch (error) {
            console.error('Failed to notify server about deactivation:', error);
            // Continue with local deactivation even if server call fails
        }

        // Clear local license
        this.storedLicense = null;

        if (fs.existsSync(LICENSE_FILE)) {
            fs.unlinkSync(LICENSE_FILE);
        }

        return { success: true, message: 'License deactivated' };
    }

    // Check if feature is enabled
    hasFeature(feature: string): boolean {
        return this.storedLicense?.licenseInfo?.features?.includes(feature) || false;
    }

    // Get license info
    getLicenseInfo() {
        if (!this.storedLicense) return null;

        return {
            ...this.storedLicense.licenseInfo,
            lastVerified: this.storedLicense.lastVerified,
            activatedAt: this.storedLicense.activatedAt,
        };
    }

    // Check if license needs renewal soon
    needsRenewal(daysThreshold = 30): boolean {
        if (!this.storedLicense) return false;
        return this.storedLicense.licenseInfo.days_remaining <= daysThreshold;
    }

    // Start periodic verification (every 24 hours)
    private startPeriodicVerification() {
        // Verify every 24 hours
        this.verificationInterval = setInterval(async () => {
            console.log('Running periodic license verification...');
            await this.verifyLicense(true);
        }, 24 * 60 * 60 * 1000);
    }

    // Stop periodic verification
    stopPeriodicVerification() {
        if (this.verificationInterval) {
            clearInterval(this.verificationInterval);
            this.verificationInterval = null;
        }
    }

    // Save license to file
    private saveStoredLicense() {
        if (!this.storedLicense) return;

        const encrypted = this.encrypt(JSON.stringify(this.storedLicense));
        fs.writeFileSync(LICENSE_FILE, encrypted, 'utf8');
    }

    // Load license from file
    private loadStoredLicense() {
        try {
            if (fs.existsSync(LICENSE_FILE)) {
                const encrypted = fs.readFileSync(LICENSE_FILE, 'utf8');
                const decrypted = this.decrypt(encrypted);
                this.storedLicense = JSON.parse(decrypted);
            }
        } catch (error) {
            console.error('Failed to load license:', error);
            this.storedLicense = null;
        }
    }

    // Simple encryption for file storage
    private encrypt(text: string): string {
        const key = crypto.scryptSync('license-encryption-key', 'salt', 32);
        const iv = Buffer.alloc(16, 0);
        const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return encrypted;
    }

    private decrypt(encrypted: string): string {
        const key = crypto.scryptSync('license-encryption-key', 'salt', 32);
        const iv = Buffer.alloc(16, 0);
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}