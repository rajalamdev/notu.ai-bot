import dotenv from 'dotenv';
import { BotConfig } from './types';

dotenv.config();

export const config: BotConfig = {
    port: parseInt(process.env.PORT || '3001', 10),
    backendUrl: process.env.BACKEND_URL || 'http://localhost:4000',
    backendWsUrl: process.env.BACKEND_WS_URL || 'ws://localhost:4000',
    botName: process.env.BOT_NAME || 'Notu.AI Bot',
    maxDurationMinutes: parseInt(process.env.MAX_MEETING_DURATION_MINUTES || '120', 10),
    flushIntervalMs: parseInt(process.env.FLUSH_INTERVAL_MS || '30000', 10),
    headless: process.env.HEADLESS !== 'false',
    debug: process.env.DEBUG !== 'false', // Default to true
};

export default config;
