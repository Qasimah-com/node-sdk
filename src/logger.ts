export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Logger = (level: LogLevel, message: string, fields: Record<string, unknown>) => void;
