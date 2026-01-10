/**
 * Type definitions for the bot service
 */

export interface Segment {
    speaker: string;
    text: string;
    start: number;
    end: number;
}

export interface BotSession {
    sessionId: string;
    meetingId: string;
    url: string;
    status: BotStatus;
    segments: Segment[];
    startedAt: Date | null;
    completedAt: Date | null;
    error: string | null;
}

export type BotStatus =
    | 'pending'
    | 'joining'
    | 'waiting_admission'
    | 'in_meeting'
    | 'recording'
    | 'leaving'
    | 'completed'
    | 'failed';

export interface JoinRequest {
    meetingUrl: string;
    meetingId: string;
    duration?: number;
    botName?: string;
}

export interface JoinResponse {
    success: boolean;
    sessionId?: string;
    meetingId?: string;
    message?: string;
    error?: string;
}

export interface StopRequest {
    reason?: string;
}

export interface StopResponse {
    success: boolean;
    transcript?: string;
    segmentCount?: number;
    duration?: number;
    error?: string;
}

export interface BotStatusResponse {
    sessionId: string;
    meetingId: string;
    status: BotStatus;
    segmentCount: number;
    duration: number;
    lastSegment?: Segment;
}

export interface CaptionEvent {
    speaker: string;
    text: string;
}

export interface BotConfig {
    port: number;
    backendUrl: string;
    backendWsUrl: string;
    botName: string;
    maxDurationMinutes: number;
    flushIntervalMs: number;
    headless: boolean;
    debug: boolean;
}
