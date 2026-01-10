/**
 * Google Account Authentication Generator (Persistent Profile)
 * 
 * This script opens Chrome with the extension and persistent profile
 * for manual Google login. The session is saved to the profile directory
 * for subsequent bot use.
 * 
 * Usage: npm run generate-auth
 */

import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const USER_DATA_DIR = path.resolve(__dirname, '..', '.chrome-profile');
const EXTENSION_PATH = path.resolve(__dirname, '..', 'extension');

async function generateAuth() {
    console.log('\n🔐 Google Meet Bot - Authentication Setup (Persistent Profile)\n');
    console.log('This will open Chrome with a persistent profile.');
    console.log('Login to your Google account, then close the browser.\n');

    // Ensure directories exist
    if (!fs.existsSync(USER_DATA_DIR)) {
        fs.mkdirSync(USER_DATA_DIR, { recursive: true });
    }

    console.log(`📁 Profile directory: ${USER_DATA_DIR}`);
    console.log(`📁 Extension path: ${EXTENSION_PATH}\n`);

    // Check if extension exists
    const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        console.error('❌ Extension not found! Make sure extension folder exists.');
        process.exit(1);
    }

    // Launch persistent context
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
        headless: false,
        args: [
            `--disable-extensions-except=${EXTENSION_PATH}`,
            `--load-extension=${EXTENSION_PATH}`,
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1280,800',
        ],
        viewport: { width: 1280, height: 800 },
    });

    const page = context.pages()[0] || await context.newPage();

    console.log('Opening Google accounts page...\n');
    await page.goto('https://accounts.google.com', { waitUntil: 'networkidle' });

    console.log('📝 Please login to your Google account in the browser window.');
    console.log('   After successful login, navigate to https://meet.google.com');
    console.log('   Then close the browser window to save the session.\n');

    // Wait for browser to close
    await new Promise<void>((resolve) => {
        context.on('close', () => {
            resolve();
        });
    });

    console.log('\n✅ Session saved to persistent profile!');
    console.log(`   Profile location: ${USER_DATA_DIR}`);
    console.log('\nYou can now run the bot with: npm run dev\n');
}

// Handle Ctrl+C
process.on('SIGINT', async () => {
    console.log('\n\n⚠️  Interrupted. Session should still be saved to profile.');
    process.exit(0);
});

generateAuth().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});
