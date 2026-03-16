/**
 * GatewayClient — OpenClaw Gateway Protocol v3 WebSocket client.
 *
 * Handles:
 * - Challenge/connect handshake
 * - DeviceToken persistence to ~/.openclaw/gateway-device.token
 * - Auto-reconnect with exponential backoff
 * - Request/response matching via pending Map
 * - Event routing to on() subscribers
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Session = {
  id?: string;
  key?: string;
  [key: string]: unknown;
};

export type Agent = {
  id?: string;
  name?: string;
  slug?: string;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// Internal frame types
// ---------------------------------------------------------------------------

type GatewayRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
};

type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code?: unknown; message?: unknown };
};

type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = 3;
const DEVICE_TOKEN_PATH = path.join(os.homedir(), ".openclaw", "gateway-device.token");
const BACKOFF_STEPS_MS = [800, 1600, 3200, 6400, 12800, 15000];
const CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rawDataToString(data: unknown): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (Array.isArray(data)) {
    return Buffer.concat(
      data.map((entry) => (Buffer.isBuffer(entry) ? entry : Buffer.from(String(entry), "utf8"))),
    ).toString("utf8");
  }
  return String(data ?? "");
}

function isResponseFrame(value: unknown): value is GatewayResponseFrame {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return r.type === "res" && typeof r.id === "string" && typeof r.ok === "boolean";
}

function isEventFrame(value: unknown): value is GatewayEventFrame {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return r.type === "event" && typeof r.event === "string";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((v) => { clearTimeout(timer); resolve(v); })
      .catch((e) => { clearTimeout(timer); reject(e); });
  });
}

function loadPersistedDeviceToken(): string | undefined {
  try {
    const token = fs.readFileSync(DEVICE_TOKEN_PATH, "utf8").trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

function persistDeviceToken(token: string): void {
  try {
    const dir = path.dirname(DEVICE_TOKEN_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DEVICE_TOKEN_PATH, token, { encoding: "utf8", mode: 0o600 });
  } catch {
    // Ignore persistence failures — client still works without it
  }
}

// ---------------------------------------------------------------------------
// GatewayClient
// ---------------------------------------------------------------------------

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Array<(payload: unknown) => void>>();
  private _connected = false;
  private _destroyed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private deviceToken: string | undefined;

  private readonly url: string;
  private readonly token: string | undefined;
  private readonly autoReconnect: boolean;

  constructor(options?: { url?: string; token?: string; autoReconnect?: boolean }) {
    this.url = options?.url ?? process.env["OPENCLAW_GATEWAY_URL"] ?? "ws://127.0.0.1:18789";
    this.token = options?.token ?? process.env["OPENCLAW_GATEWAY_TOKEN"];
    this.autoReconnect = options?.autoReconnect ?? false;
    this.deviceToken = loadPersistedDeviceToken();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  isConnected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._destroyed) throw new Error("GatewayClient has been destroyed");
    await this._doConnect();
  }

  disconnect(): void {
    this._destroyed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close(1000, "client-disconnect");
      this.ws = null;
    }
    this._connected = false;
    this._failAllPending(new Error("client disconnected"));
  }

  /**
   * Send a chat message to a session and wait for the full response.
   * Resolves with the assistant's full reply text when chat.done fires.
   */
  async sendMessage(session: string, message: string): Promise<string> {
    const idempotencyKey = randomUUID();

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._off("chat.done", onDone);
        reject(new Error(`sendMessage timeout waiting for chat.done on session ${session}`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);

      const onDone = (payload: unknown) => {
        const record = asRecord(payload);
        if (!record) return;
        // If payload includes a session field, only resolve for our session
        const sessionField = nonEmpty(record["session"]);
        if (sessionField && sessionField !== session) return;
        clearTimeout(timeout);
        this._off("chat.done", onDone);
        const text =
          nonEmpty(record["text"]) ??
          nonEmpty(record["response"]) ??
          nonEmpty(record["content"]) ??
          "";
        resolve(text);
      };

      this.on("chat.done", onDone);

      this._request("chat.send", { session, message, idempotencyKey }).catch((err: unknown) => {
        clearTimeout(timeout);
        this._off("chat.done", onDone);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  async listSessions(): Promise<Session[]> {
    const payload = await this._request<unknown>("sessions.list", {});
    if (Array.isArray(payload)) return payload as Session[];
    const record = asRecord(payload);
    const arr = record?.["sessions"];
    return Array.isArray(arr) ? (arr as Session[]) : [];
  }

  async ensureSession(sessionKey: string): Promise<void> {
    await this._request("sessions.ensure", { session: sessionKey, idempotencyKey: randomUUID() });
  }

  async listAgents(): Promise<Agent[]> {
    const payload = await this._request<unknown>("agents.list", {});
    if (Array.isArray(payload)) return payload as Agent[];
    const record = asRecord(payload);
    const arr = record?.["agents"];
    return Array.isArray(arr) ? (arr as Agent[]) : [];
  }

  async cronList(): Promise<unknown[]> {
    const payload = await this._request<unknown>("cron.list", {});
    if (Array.isArray(payload)) return payload;
    const record = asRecord(payload);
    const arr = record?.["crons"];
    return Array.isArray(arr) ? arr : [];
  }

  async configGet(): Promise<Record<string, unknown>> {
    const payload = await this._request<unknown>("config.get", {});
    return asRecord(payload) ?? {};
  }

  on(event: string, handler: (payload: unknown) => void): void {
    const handlers = this.eventHandlers.get(event) ?? [];
    handlers.push(handler);
    this.eventHandlers.set(event, handlers);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private _off(event: string, handler: (payload: unknown) => void): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    const filtered = handlers.filter((h) => h !== handler);
    if (filtered.length > 0) {
      this.eventHandlers.set(event, filtered);
    } else {
      this.eventHandlers.delete(event);
    }
  }

  private _emit(event: string, payload: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(payload);
      } catch {
        // Ignore handler errors
      }
    }
  }

  private _request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("GatewayClient not connected"));
    }

    const id = randomUUID();
    const frame: GatewayRequestFrame = { type: "req", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`gateway request timeout (${method})`));
            }, timeoutMs)
          : null;

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify(frame));
    });
  }

  private _handleMessage(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (isEventFrame(parsed)) {
      // connect.challenge is consumed during _doConnect; ignore here
      if (parsed.event !== "connect.challenge") {
        this._emit(parsed.event, parsed.payload);
      }
      return;
    }

    if (!isResponseFrame(parsed)) return;

    const pending = this.pending.get(parsed.id);
    if (!pending) return;

    if (pending.timer) clearTimeout(pending.timer);
    this.pending.delete(parsed.id);

    if (parsed.ok) {
      pending.resolve(parsed.payload ?? null);
      return;
    }

    const errorRecord = asRecord(parsed.error);
    const message =
      nonEmpty(errorRecord?.["message"]) ??
      nonEmpty(errorRecord?.["code"]) ??
      "gateway request failed";
    pending.reject(new Error(message));
  }

  private _failAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  private _doConnect(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, { maxPayload: 25 * 1024 * 1024 });
      this.ws = ws;

      let settled = false;

      // Challenge promise — resolved when connect.challenge event arrives
      let challengeResolve!: (nonce: string) => void;
      let challengeReject!: (err: Error) => void;
      const challengePromise = new Promise<string>((res, rej) => {
        challengeResolve = res;
        challengeReject = rej;
      });

      const fail = (err: Error) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
        // Safe to call multiple times — Promise ignores subsequent calls
        challengeReject(err);
      };

      ws.on("message", (data) => {
        const raw = rawDataToString(data);
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return;
        }

        // Intercept challenge event for the handshake
        if (isEventFrame(parsed) && parsed.event === "connect.challenge") {
          const payload = asRecord(parsed.payload);
          const nonce = nonEmpty(payload?.["nonce"]);
          if (nonce) challengeResolve(nonce);
          return;
        }

        this._handleMessage(raw);
      });

      ws.on("error", (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });

      ws.on("close", (code, reason) => {
        this._connected = false;
        const err = new Error(`gateway closed (${code}): ${rawDataToString(reason)}`);
        fail(err);
        this._failAllPending(err);
        if (!this._destroyed && this.autoReconnect) {
          this._scheduleReconnect();
        }
      });

      ws.once("open", () => {
        void (async () => {
          try {
            // Wait for connect.challenge
            const nonce = await withTimeout(
              challengePromise,
              CONNECT_TIMEOUT_MS,
              "connect.challenge timeout",
            );

            // Build auth — prefer persisted deviceToken for reconnects
            const auth: Record<string, unknown> = {};
            if (this.deviceToken) {
              auth["deviceToken"] = this.deviceToken;
            } else if (this.token) {
              auth["token"] = this.token;
            }

            // Send connect request and wait for hello-ok
            const hello = await withTimeout(
              this._request<Record<string, unknown>>(
                "connect",
                {
                  minProtocol: PROTOCOL_VERSION,
                  maxProtocol: PROTOCOL_VERSION,
                  client: { name: "gtm-agent", version: "1.0.0" },
                  role: "operator",
                  scopes: ["operator.read", "operator.write"],
                  auth: Object.keys(auth).length > 0 ? auth : undefined,
                  // Echo nonce back so gateway can verify freshness
                  nonce,
                },
                CONNECT_TIMEOUT_MS,
              ),
              CONNECT_TIMEOUT_MS,
              "connect response timeout",
            );

            // Persist deviceToken from hello-ok for future reconnects
            const newDeviceToken = nonEmpty(hello?.["deviceToken"]);
            if (newDeviceToken) {
              this.deviceToken = newDeviceToken;
              persistDeviceToken(newDeviceToken);
            }

            this._connected = true;
            this.reconnectAttempt = 0;

            if (!settled) {
              settled = true;
              resolve();
            }
          } catch (err) {
            fail(err instanceof Error ? err : new Error(String(err)));
          }
        })();
      });
    });
  }

  private _scheduleReconnect(): void {
    if (this._destroyed) return;
    const delay =
      BACKOFF_STEPS_MS[Math.min(this.reconnectAttempt, BACKOFF_STEPS_MS.length - 1)];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this._destroyed) {
        this._doConnect().catch(() => {
          // _doConnect's own close handler will call _scheduleReconnect again
        });
      }
    }, delay);
  }
}
