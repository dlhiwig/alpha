// Missing npm packages - stub declarations for transplanted SuperClaw code
declare module 'uuid' { export function v4(): string; export function v5(name: string, namespace: string): string; }
declare module 'better-sqlite3' { const Database: any; export = Database; }
declare module 'node-cron' { export function schedule(expression: string, func: () => void, options?: any): any; export function validate(expression: string): boolean; }
declare module 'cli-table3' { class Table { constructor(opts?: any); push(...args: any[]): void; toString(): string; } export = Table; }
declare module 'cheerio' { export function load(html: string): any; }
declare module 'ink' { export const render: any; export const Box: any; export const Text: any; export const useInput: any; export const useApp: any; export const Spacer: any; export const Static: any; export const Transform: any; }
declare module '@inkjs/ui' { export const TextInput: any; export const Select: any; export const Spinner: any; export const Badge: any; export const ProgressBar: any; }
declare module 'react' { export default {} as any; export const useState: any; export const useEffect: any; export const useCallback: any; export const useMemo: any; export const useRef: any; export const createElement: any; export type FC<P = {}> = (props: P) => any; export type ReactNode = any; }

declare module 'fastify' { const x: any; export = x; export default x; }
declare module '@fastify/websocket' { const x: any; export default x; }
declare module '@fastify/cors' { const x: any; export default x; }
declare module '@vercel/postgres' { export const sql: any; }
declare module '@vercel/sdk' { const x: any; export default x; }
declare module '@neondatabase/toolkit' { export class NeonToolkit { constructor(opts: any); } }
declare module '@google/generative-ai' { export class GoogleGenerativeAI { constructor(key: string); getGenerativeModel(opts: any): any; } export const HarmCategory: any; export const HarmBlockThreshold: any; }

// Channel contracts stubs (SuperClaw standalone - not implemented in Alpha)
declare module '../channels/contracts.js' {
  export type SupportedPlatform = 'telegram' | 'whatsapp' | 'signal';
  export interface IncomingMessage { from: string; content: string; platform: SupportedPlatform; timestamp: number; [key: string]: any; }
  export interface MessageContent { text?: string; media?: any; [key: string]: any; }
  export interface MessageResult { success: boolean; messageId?: string; error?: string; }
  export interface ConnectorStatus { connected: boolean; platform: SupportedPlatform; error?: string; }
  export interface NormalizedMessage { content: string; userId: string; platform: SupportedPlatform; metadata: any; }
  export interface Contact { id: string; name?: string; platform: SupportedPlatform; }
  export interface IChannelConnector { send(message: MessageContent): Promise<MessageResult>; start(): Promise<void>; stop(): Promise<void>; }
  export interface TelegramConfig { botToken: string; [key: string]: any; }
  export interface WhatsAppConfig { accountSid: string; authToken: string; [key: string]: any; }
  export interface SignalConfig { number: string; [key: string]: any; }
}

declare module '../channels/index.js' {
  export function createTelegramConnector(config: any): any;
  export function createWhatsAppConnector(config: any): any;
  export function createSignalConnector(config: any): any;
}
