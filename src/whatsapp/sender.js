// Tenant-aware WhatsApp Cloud API client for the flow engine. Each tenant sends from its own
// phone_number_id with its own token. Every outbound message is written to MessageLog.
const fs = require("fs/promises");
const path = require("path");
const env = require("../config/env");
const { prisma, toJson } = require("../db/prisma");
const { logError, logInfo } = require("../utils/logger");

class WhatsAppApiError extends Error {
  constructor(status, data) {
    const meta = data?.error || {};
    super(`WhatsApp API ${status}${meta.code ? ` (code ${meta.code})` : ""}: ${meta.error_user_msg || meta.message || "request failed"}`);
    this.status = status;
    this.code = meta.code;
    this.retryable = status >= 500 || status === 429;
  }
}

const graphUrl = (p) => `https://graph.facebook.com/${env.WHATSAPP_GRAPH_API_VERSION}/${p}`;
const digits = (phone) => String(phone || "").replace(/\D/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function assertConfigured(tenant) {
  if (!tenant.whatsapp.phoneNumberId || !tenant.whatsapp.accessToken) {
    throw new Error(`WhatsApp is not configured for ${tenant.name} (phone number ID / access token missing).`);
  }
}

async function withRetry(fn, retries = 2) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const retryable = error instanceof WhatsAppApiError ? error.retryable : true; // network errors / timeouts
      if (!retryable || attempt >= retries) throw error;
      await sleep(500 * 3 ** attempt);
    }
  }
}

const liveTransport = {
  async post(tenant, body) {
    assertConfigured(tenant);
    return withRetry(async () => {
      const res = await fetch(graphUrl(`${tenant.whatsapp.phoneNumberId}/messages`), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tenant.whatsapp.accessToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new WhatsAppApiError(res.status, data);
      return { id: data.messages?.[0]?.id };
    });
  },

  // Media URLs from GET /{media-id} expire after ~5 minutes, so resolve and download in one go.
  async downloadMedia(tenant, mediaId) {
    assertConfigured(tenant);
    const auth = { authorization: `Bearer ${tenant.whatsapp.accessToken}` };
    const meta = await withRetry(async () => {
      const res = await fetch(graphUrl(`${mediaId}?phone_number_id=${tenant.whatsapp.phoneNumberId}`), {
        headers: auth,
        signal: AbortSignal.timeout(10000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new WhatsAppApiError(res.status, data);
      return data;
    });
    const file = await withRetry(async () => {
      const res = await fetch(meta.url, { headers: auth, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new WhatsAppApiError(res.status, {});
      return Buffer.from(await res.arrayBuffer());
    });
    return { buffer: file, mimeType: meta.mime_type };
  },
};

let transport = liveTransport;

// Tests swap in a fake transport; pass null to restore the live one.
function setTransport(fake) {
  transport = fake || liveTransport;
}

async function send(tenant, to, payload, { sessionId = null } = {}) {
  const body = { messaging_product: "whatsapp", recipient_type: "individual", to: digits(to), ...payload };
  const { id } = await transport.post(tenant, body);
  const waMessageId = id || `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await prisma.messageLog
    .create({
      data: { tenantId: tenant.id, sessionId, direction: "out", waMessageId, type: payload.type, payload: toJson(payload), status: "accepted" },
    })
    .catch((error) => logError("FLOW_MESSAGE_LOG_FAILED", error, { waMessageId }));
  logInfo("FLOW_MESSAGE_SENT", { tenantId: tenant.id, type: payload.type, waMessageId });
  return waMessageId;
}

const text = (tenant, to, body, options) => send(tenant, to, { type: "text", text: { body, preview_url: false } }, options);

const EXTENSIONS = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
};

// Downloads inbound media to uploads/{tenantId}/{sessionId}/ and returns the path relative to UPLOADS_DIR.
async function saveMedia(tenant, sessionId, media) {
  const { buffer, mimeType } = await transport.downloadMedia(tenant, media.id);
  const type = media.mimeType || mimeType || "";
  const safeId = String(media.id).replace(/[^\w-]/g, "");
  const ext = EXTENSIONS[type.split(";")[0]] || path.extname(media.filename || "") || "";
  const relative = path.posix.join(tenant.id, sessionId, `${safeId}${ext}`);
  const absolute = path.join(path.resolve(env.UPLOADS_DIR), relative);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, buffer);
  return relative;
}

module.exports = { send, text, saveMedia, setTransport, WhatsAppApiError };
