/**
 * Bot Service Entry Point
 * 
 * Express server providing REST API for bot control
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import config from './config';
import { getSessionManager } from './sessionManager';
import { JoinRequest, JoinResponse, StopRequest, StopResponse, BotStatusResponse } from './types';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req: Request, res: Response) => {
    res.json({
        status: 'healthy',
        service: 'notu-bot-service',
        activeSessions: getSessionManager().getAllSessions().length,
    });
});

/**
 * POST /api/bot/join
 * Start a bot to join a meeting
 */
app.post('/api/bot/join', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { meetingUrl, meetingId, duration, botName } = req.body as JoinRequest;

        if (!meetingUrl || !meetingId) {
            return res.status(400).json({
                success: false,
                error: 'meetingUrl and meetingId are required',
            } as JoinResponse);
        }

        // Validate URL is Google Meet
        if (!meetingUrl.includes('meet.google.com')) {
            return res.status(400).json({
                success: false,
                error: 'Only Google Meet URLs are supported',
            } as JoinResponse);
        }

        console.log(`[API] Starting bot for meeting ${meetingId}: ${meetingUrl}`);

        const sessionManager = getSessionManager();
        const session = await sessionManager.startSession(meetingId, meetingUrl);

        res.json({
            success: true,
            sessionId: session.sessionId,
            meetingId: session.meetingId,
            message: 'Bot started successfully',
        } as JoinResponse);
    } catch (error: any) {
        console.error('[API] Join error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        } as JoinResponse);
    }
});

/**
 * POST /api/bot/:meetingId/stop
 * Stop a bot session
 */
app.post('/api/bot/:meetingId/stop', async (req: Request, res: Response) => {
    try {
        const { meetingId } = req.params;
        const { reason } = req.body as StopRequest;

        console.log(`[API] Stopping bot for meeting ${meetingId}`);

        const sessionManager = getSessionManager();
        const session = await sessionManager.stopSession(meetingId, reason || 'user_requested');

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found',
            } as StopResponse);
        }

        // Build transcript from segments
        const transcript = session.segments
            .map((s) => `${s.speaker}: ${s.text}`)
            .join('\n');

        const duration = session.startedAt && session.completedAt
            ? (session.completedAt.getTime() - session.startedAt.getTime()) / 1000
            : 0;

        res.json({
            success: true,
            transcript,
            segmentCount: session.segments.length,
            duration,
        } as StopResponse);
    } catch (error: any) {
        console.error('[API] Stop error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        } as StopResponse);
    }
});

/**
 * GET /api/bot/:meetingId/status
 * Get bot session status
 */
app.get('/api/bot/:meetingId/status', (req: Request, res: Response) => {
    try {
        const { meetingId } = req.params;

        const sessionManager = getSessionManager();
        const session = sessionManager.getSession(meetingId);

        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found',
            });
        }

        const duration = session.startedAt
            ? (Date.now() - session.startedAt.getTime()) / 1000
            : 0;

        res.json({
            sessionId: session.sessionId,
            meetingId: session.meetingId,
            status: session.status,
            segmentCount: session.segments.length,
            duration,
            lastSegment: session.segments.length > 0
                ? session.segments[session.segments.length - 1]
                : undefined,
        } as BotStatusResponse);
    } catch (error: any) {
        console.error('[API] Status error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
        });
    }
});

/**
 * GET /api/bot/sessions
 * Get all active sessions
 */
app.get('/api/bot/sessions', (req: Request, res: Response) => {
    const sessionManager = getSessionManager();
    const sessions = sessionManager.getAllSessions().map((s) => ({
        sessionId: s.sessionId,
        meetingId: s.meetingId,
        status: s.status,
        segmentCount: s.segments.length,
        startedAt: s.startedAt,
    }));

    res.json({
        success: true,
        sessions,
        count: sessions.length,
    });
});

// Error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error('[API] Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
    });
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[API] Received SIGINT, shutting down...');
    await getSessionManager().shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[API] Received SIGTERM, shutting down...');
    await getSessionManager().shutdown();
    process.exit(0);
});

// Start server
app.listen(config.port, () => {
    console.log(`\n🤖 Bot Service running on port ${config.port}`);
    console.log(`   Backend URL: ${config.backendUrl}`);
    console.log(`   Headless: ${config.headless}`);
    console.log(`   Max Duration: ${config.maxDurationMinutes} minutes\n`);
});

export default app;
