/**
 * Bot Session Manager
 * 
 * Manages multiple bot sessions and their lifecycle
 */

import { EventEmitter } from 'events';
import { io, Socket } from 'socket.io-client';
import axios from 'axios';
import config from './config';
import { MeetBot } from './meetBot';
import { BotSession, BotStatus, Segment } from './types';

export class BotSessionManager extends EventEmitter {
    private sessions: Map<string, MeetBot> = new Map();
    private socket: Socket | null = null;

    constructor() {
        super();
        this.connectToBackend();
    }

    /**
     * Connect to backend via Socket.IO
     */
    private connectToBackend(): void {
        try {
            this.socket = io(config.backendWsUrl, {
                transports: ['websocket'],
                reconnection: true,
                reconnectionAttempts: 10,
                reconnectionDelay: 1000,
            });

            this.socket.on('connect', () => {
                console.log('[SessionManager] Connected to backend WebSocket');
                // Register as bot service
                this.socket?.emit('bot_service_connected', { service: 'meet-bot' });
            });

            this.socket.on('disconnect', () => {
                console.log('[SessionManager] Disconnected from backend WebSocket');
            });

            this.socket.on('error', (error) => {
                console.error('[SessionManager] Socket error:', error);
            });
        } catch (error) {
            console.error('[SessionManager] Failed to connect to backend:', error);
        }
    }

    /**
     * Start a new bot session
     */
    async startSession(meetingId: string, url: string): Promise<BotSession> {
        // Check if session already exists
        if (this.sessions.has(meetingId)) {
            const existing = this.sessions.get(meetingId)!;
            return existing.getSession();
        }

        // Create new bot
        const bot = new MeetBot(meetingId, url);
        this.sessions.set(meetingId, bot);

        // Set up event handlers
        bot.on('status', (data) => {
            this.emitToBackend('bot_status_change', {
                meetingId,
                status: data.status,
                message: data.message,
            });
        });

        bot.on('caption', (data) => {
            console.log(`[SessionManager] 📝 Caption from meeting ${meetingId}: ${data.segment?.text?.substring(0, 40)}...`);

            // Emit via WebSocket for real-time (if connected)
            this.emitToBackend('caption_added', {
                meetingId: data.meetingId,
                segment: data.segment,
            });

            // ALSO send HTTP POST to update database immediately
            // This ensures frontend polling gets the caption
            this.sendCaptionToBackend(meetingId, data.segment);
        });

        bot.on('flush', (data) => {
            this.sendSegmentsToBackend(meetingId, data.segments);
        });

        // Handle natural meeting completion (when meeting ends, not manual stop)
        bot.on('completed', async (data) => {
            console.log(`[SessionManager] Meeting ${meetingId} completed naturally:`, data.reason);

            // Emit to backend
            this.emitToBackend('bot_meeting_ended', {
                meetingId,
                session: bot.getSession(),
                reason: data.reason,
            });

            // Finalize the meeting (send transcript to backend)
            await this.finalizeMeeting(meetingId, {
                ...bot.getSession(),
                segments: data.segments,
                completedAt: new Date(),
            });

            // Clean up session
            this.sessions.delete(meetingId);
            console.log(`[SessionManager] Session ${meetingId} cleaned up after natural completion`);
        });

        // Start joining
        try {
            await bot.join();
            return bot.getSession();
        } catch (error: any) {
            this.sessions.delete(meetingId);
            throw error;
        }
    }

    /**
     * Stop a bot session
     */
    async stopSession(meetingId: string, reason = 'user_requested'): Promise<BotSession | null> {
        const bot = this.sessions.get(meetingId);
        if (!bot) {
            console.log(`[SessionManager] No session found for meeting ${meetingId}`);
            return null;
        }

        const session = await bot.leave(reason);
        this.sessions.delete(meetingId);

        // Notify backend
        this.emitToBackend('bot_meeting_ended', {
            meetingId,
            session,
            reason,
        });

        // Send final segments
        await this.finalizeMeeting(meetingId, session);

        return session;
    }

    /**
     * Get session status
     */
    getSession(meetingId: string): BotSession | null {
        const bot = this.sessions.get(meetingId);
        return bot ? bot.getSession() : null;
    }

    /**
     * Get all active sessions
     */
    getAllSessions(): BotSession[] {
        return Array.from(this.sessions.values()).map((bot) => bot.getSession());
    }

    /**
     * Emit event to backend via Socket.IO
     */
    private emitToBackend(event: string, data: any): void {
        if (this.socket?.connected) {
            this.socket.emit(event, data);
        }
    }

    /**
     * Send segments to backend via HTTP
     */
    private async sendSegmentsToBackend(meetingId: string, segments: Segment[]): Promise<void> {
        try {
            await axios.post(`${config.backendUrl}/api/bot/${meetingId}/segments`, {
                segments,
            });
        } catch (error: any) {
            console.error('[SessionManager] Failed to send segments:', error.message);
        }
    }

    /**
     * Send single caption to backend via HTTP for real-time DB update
     */
    private async sendCaptionToBackend(meetingId: string, segment: Segment): Promise<void> {
        try {
            // Send as single-segment array to reuse existing endpoint
            await axios.post(`${config.backendUrl}/api/bot/${meetingId}/segments`, {
                segments: [segment],
            });
        } catch (error: any) {
            // Don't log every failure to avoid spam - just silently retry via flush
        }
    }

    /**
     * Finalize meeting on backend
     */
    private async finalizeMeeting(meetingId: string, session: BotSession): Promise<void> {
        try {
            await axios.post(`${config.backendUrl}/api/bot/${meetingId}/finalize`, {
                sessionId: session.sessionId,
                segments: session.segments,
                duration: session.startedAt && session.completedAt
                    ? (session.completedAt.getTime() - session.startedAt.getTime()) / 1000
                    : 0,
            });
            console.log(`[SessionManager] Finalized meeting ${meetingId}`);
        } catch (error: any) {
            console.error('[SessionManager] Failed to finalize meeting:', error.message);
        }
    }

    /**
     * Shutdown all sessions
     */
    async shutdown(): Promise<void> {
        console.log('[SessionManager] Shutting down...');

        const stopPromises = Array.from(this.sessions.keys()).map((meetingId) =>
            this.stopSession(meetingId, 'service_shutdown')
        );

        await Promise.all(stopPromises);

        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }

        console.log('[SessionManager] Shutdown complete');
    }
}

// Singleton instance
let instance: BotSessionManager | null = null;

export function getSessionManager(): BotSessionManager {
    if (!instance) {
        instance = new BotSessionManager();
    }
    return instance;
}

export default BotSessionManager;
