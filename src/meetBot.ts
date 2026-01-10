/**
 * Google Meet Bot - Hybrid Architecture
 * 
 * Uses Playwright as orchestrator with Chrome Extension for DOM interaction.
 * This approach bypasses bot detection by having the extension (native resident)
 * handle all DOM manipulation while Playwright only manages the browser lifecycle.
 */

import { chromium, BrowserContext, Page } from 'playwright';
import { EventEmitter } from 'events';
import path from 'path';
import fs from 'fs';
import config from './config';
import { BotSession, BotStatus, Segment } from './types';

// Extension message types
interface ExtensionMessage {
    source: string;
    type: string;
    data: any;
    timestamp: number;
}

export class MeetBot extends EventEmitter {
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private session: BotSession;
    private segments: Segment[] = [];
    private isLeaving = false;
    private flushInterval: NodeJS.Timeout | null = null;
    private timeoutTimer: NodeJS.Timeout | null = null;
    private messageHandler: ((msg: ExtensionMessage) => void) | null = null;

    constructor(meetingId: string, url: string) {
        super();
        this.session = {
            sessionId: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            meetingId,
            url,
            status: 'pending',
            segments: [],
            startedAt: null,
            completedAt: null,
            error: null,
        };
    }

    /**
     * Get current session info
     */
    getSession(): BotSession {
        return {
            ...this.session,
            segments: this.segments,
        };
    }

    /**
     * Update and emit status
     */
    private setStatus(status: BotStatus, message?: string): void {
        this.session.status = status;
        if (status === 'failed' && message) {
            this.session.error = message;
        }
        this.emit('status', { status, message, session: this.getSession() });
        console.log(`[MeetBot] Status: ${status}${message ? ` - ${message}` : ''}`);
    }

    /**
     * Join meeting using hybrid architecture
     */
    async join(): Promise<void> {
        try {
            this.setStatus('joining');

            // Paths
            const extensionPath = path.resolve(__dirname, '..', 'extension');
            const userDataDir = path.resolve(__dirname, '..', '.chrome-profile');

            // Ensure user data dir exists
            if (!fs.existsSync(userDataDir)) {
                fs.mkdirSync(userDataDir, { recursive: true });
            }

            // Check extension exists
            if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
                throw new Error(`Extension not found at ${extensionPath}`);
            }

            console.log('[MeetBot] Launching persistent browser with extension...');
            console.log(`[MeetBot] Extension path: ${extensionPath}`);
            console.log(`[MeetBot] User data dir: ${userDataDir}`);

            // Launch persistent context with extension
            // This uses a real Chrome profile, not incognito
            this.context = await chromium.launchPersistentContext(userDataDir, {
                headless: false, // Extension requires headed mode
                args: [
                    `--disable-extensions-except=${extensionPath}`,
                    `--load-extension=${extensionPath}`,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-infobars',
                    '--use-fake-ui-for-media-stream',
                    '--use-fake-device-for-media-stream',
                    '--window-size=1400,900',
                    '--window-position=0,0',
                ],
                viewport: { width: 1366, height: 768 },
                locale: 'en-US',
                timezoneId: 'America/New_York',
                permissions: ['microphone', 'camera'],
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            });

            // Get existing page or create new one
            const pages = this.context.pages();
            this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

            // Enable console logging for debugging
            if (config.debug) {
                this.page.on('console', (msg) => console.log(`[Browser] ${msg.type()}: ${msg.text()}`));
            }

            // Set up message listener for extension communication
            this.setupExtensionMessageListener();

            // Navigate to meeting URL
            console.log(`[MeetBot] Navigating to: ${this.session.url}`);
            await this.page.goto(this.session.url, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Wait for page to stabilize
            await this.page.waitForTimeout(3000);

            // Trigger extension auto-start
            await this.triggerExtensionStart();

            // Wait for extension to report status
            this.setStatus('waiting_admission');
            const joined = await this.waitForExtensionJoin(120000);

            if (!joined) {
                throw new Error('Extension failed to join meeting');
            }

            this.setStatus('in_meeting');
            this.session.startedAt = new Date();

            // Start caption collection
            this.setStatus('recording');

            // Setup flush interval
            this.flushInterval = setInterval(() => this.flushSegments(), config.flushIntervalMs);

            // Setup max duration timeout
            this.timeoutTimer = setTimeout(
                () => this.leave('max_duration_reached'),
                config.maxDurationMinutes * 60 * 1000
            );

            console.log('[MeetBot] Bot is now recording via extension');

        } catch (error: any) {
            console.error('[MeetBot] Join error:', error);
            this.setStatus('failed', error.message);
            await this.cleanup();
            throw error;
        }
    }

    /**
     * Set up listener for messages from the extension via console.log parsing
     * This is more reliable than postMessage as it works regardless of timing
     */
    private setupExtensionMessageListener(): void {
        if (!this.page) return;

        // Parse console logs from the extension
        this.page.on('console', (msg) => {
            const text = msg.text();

            // Log all browser console messages in debug mode
            if (config.debug) {
                console.log(`[Browser] ${msg.type()}: ${text}`);
            }

            // Parse extension messages from log format
            if (text.includes('[Notu.AI Bot]')) {
                this.parseExtensionLog(text);
            }
        });
    }

    /**
     * Parse extension log messages for status and caption updates
     */
    private parseExtensionLog(text: string): void {
        // Status updates
        if (text.includes('IN_MEETING status sent')) {
            console.log('[MeetBot] 🎉 Extension confirmed: IN_MEETING');
            this.setStatus('in_meeting');
        } else if (text.includes('Successfully joined meeting')) {
            console.log('[MeetBot] 🎉 Extension confirmed: JOINED');
            this.setStatus('in_meeting');
        } else if (text.includes('Bot is now recording')) {
            console.log('[MeetBot] 🎤 Extension confirmed: RECORDING');
            this.setStatus('recording');
        } else if (text.includes('Captions enabled')) {
            console.log('[MeetBot] 📝 Captions enabled');
        } else if (text.includes('Meeting ended detected') || text.includes('Leaving meeting')) {
            console.log('[MeetBot] 🔚 Meeting ended, cleaning up');
            this.handleMeetingEnd();
        } else if (text.includes('Could not join meeting') || text.includes('Blocked from joining')) {
            console.log('[MeetBot] ❌ Failed to join');
            this.setStatus('failed', 'Could not join meeting');
        }

        // Caption parsing: look for [Caption] format
        const captionMatch = text.match(/\[Caption\]\s*(.+?):\s*(.+)/);
        if (captionMatch) {
            const speaker = captionMatch[1].trim();
            const captionText = captionMatch[2].trim();
            this.handleCaption({
                speaker,
                text: captionText,
                index: this.segments.length,
                timestamp: Date.now() - (this.session.startedAt?.getTime() || Date.now()),
            });
        }
    }

    /**
     * Handle meeting end from extension
     */
    private async handleMeetingEnd(): Promise<void> {
        if (this.isLeaving) return; // Prevent double execution
        this.isLeaving = true;
        console.log('[MeetBot] Handling meeting end...');

        // Calculate duration
        const duration = this.session.startedAt
            ? (Date.now() - this.session.startedAt.getTime()) / 1000
            : 0;

        // EMIT COMPLETED EVENT with all segments - this triggers SessionManager.finalizeMeeting()
        console.log(`[MeetBot] Emitting completed event with ${this.segments.length} segments`);
        this.emit('completed', {
            meetingId: this.session.meetingId,
            reason: 'meeting_ended',
            segments: this.segments,
            duration: duration,
        });

        await this.leave('meeting_ended');
    }

    /**
     * Handle messages from the extension
     */
    private handleExtensionMessage(message: ExtensionMessage): void {
        console.log(`[MeetBot] Extension message: ${message.type}`, message.data);

        switch (message.type) {
            case 'status':
                const extStatus = message.data.status;
                if (extStatus === 'in_meeting') {
                    this.setStatus('in_meeting');
                } else if (extStatus === 'recording') {
                    this.setStatus('recording');
                } else if (extStatus === 'waiting_admission') {
                    this.setStatus('waiting_admission', message.data.message);
                } else if (extStatus === 'failed') {
                    this.setStatus('failed', message.data.error);
                } else if (extStatus === 'joining') {
                    this.setStatus('joining');
                } else if (extStatus === 'enabling_captions') {
                    console.log('[MeetBot] Extension enabling captions...');
                } else if (extStatus === 'leaving') {
                    console.log('[MeetBot] Extension leaving meeting:', message.data.reason);
                }
                break;

            case 'caption':
                this.handleCaption(message.data);
                break;

            case 'flush':
                // Handle periodic flush from extension
                console.log(`[MeetBot] Extension flush: ${message.data.count} segments`);
                break;

            case 'completed':
                // Meeting ended - cleanup and emit completion
                console.log('[MeetBot] Meeting completed:', message.data.reason);
                this.handleCompletion(message.data);
                break;

            case 'loaded':
                console.log('[MeetBot] Extension loaded on page');
                break;
        }
    }

    /**
     * Handle meeting completion from extension
     */
    private async handleCompletion(data: { reason: string; segments: any[]; segmentCount: number; duration: number }): Promise<void> {
        console.log(`[MeetBot] Handling completion: ${data.reason}, ${data.segmentCount} segments`);

        // Update segments if provided
        if (data.segments && data.segments.length > 0) {
            this.segments = data.segments.map(s => ({
                speaker: s.speaker,
                text: s.text,
                start: s.start,
                end: s.end,
            }));
        }

        // Emit completion
        this.emit('completed', {
            meetingId: this.session.meetingId,
            reason: data.reason,
            segments: this.segments,
            duration: data.duration,
        });

        // Leave and cleanup
        await this.leave(data.reason);
    }

    /**
     * Handle caption from extension
     */
    private handleCaption(data: { speaker: string; text: string; index: number; timestamp: number }): void {
        console.log(`[Caption] ${data.speaker}: ${data.text}`);

        const segment: Segment = {
            speaker: data.speaker,
            text: data.text,
            start: data.timestamp / 1000,
            end: data.timestamp / 1000,
        };

        this.segments.push(segment);

        // Emit caption event for real-time updates
        this.emit('caption', {
            meetingId: this.session.meetingId,
            segment,
        });
    }

    /**
     * Trigger extension to start
     */
    private async triggerExtensionStart(): Promise<void> {
        if (!this.page) return;

        // Send start command to extension via window.postMessage
        await this.page.evaluate(() => {
            window.postMessage({
                source: 'notu-bot-controller',
                type: 'start',
            }, '*');
        });

        console.log('[MeetBot] Triggered extension start');
    }

    /**
     * Wait for extension to report successful join
     */
    private async waitForExtensionJoin(timeout: number): Promise<boolean> {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const checkStatus = () => {
                if (this.session.status === 'in_meeting' || this.session.status === 'recording') {
                    resolve(true);
                    return;
                }

                if (this.session.status === 'failed') {
                    resolve(false);
                    return;
                }

                if (Date.now() - startTime >= timeout) {
                    console.log('[MeetBot] Timeout waiting for extension to join');
                    resolve(false);
                    return;
                }

                setTimeout(checkStatus, 1000);
            };

            checkStatus();
        });
    }

    /**
     * Flush segments to backend
     */
    private flushSegments(): void {
        if (this.segments.length === 0) return;

        const segmentsToFlush = [...this.segments];

        this.emit('flush', {
            meetingId: this.session.meetingId,
            segments: segmentsToFlush,
            count: segmentsToFlush.length,
            duration: (Date.now() - (this.session.startedAt?.getTime() || Date.now())) / 1000,
        });

        console.log(`[MeetBot] Flushed ${segmentsToFlush.length} segments`);
    }

    /**
     * Leave meeting and cleanup
     */
    async leave(reason = 'user_requested'): Promise<BotSession> {
        console.log(`[MeetBot] Leaving meeting: ${reason}`);
        this.setStatus('leaving');

        // Tell extension to stop
        if (this.page) {
            try {
                await this.page.evaluate(() => {
                    window.postMessage({
                        source: 'notu-bot-controller',
                        type: 'stop',
                    }, '*');
                });
            } catch (e) {
                // Page may be closed
            }
        }

        // Final flush
        this.flushSegments();

        // Cleanup
        await this.cleanup();

        this.session.completedAt = new Date();
        this.session.segments = this.segments;
        this.setStatus('completed');

        return this.getSession();
    }

    /**
     * Cleanup resources
     */
    private async cleanup(): Promise<void> {
        if (this.flushInterval) {
            clearInterval(this.flushInterval);
            this.flushInterval = null;
        }

        if (this.timeoutTimer) {
            clearTimeout(this.timeoutTimer);
            this.timeoutTimer = null;
        }

        if (this.context) {
            await this.context.close().catch(() => { });
            this.context = null;
        }

        this.page = null;
        console.log('[MeetBot] Cleanup complete');
    }
}

export default MeetBot;
