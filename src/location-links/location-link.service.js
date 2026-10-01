// One-time browser location links for Location Link nodes.
// The raw token only ever lives in the WhatsApp message; the database keeps its SHA-256.
const crypto = require("crypto");
const env = require("../config/env");
const { prisma } = require("../db/prisma");

const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

function linkUrl(token) {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/flow-location/${token}`;
}

async function createLink({ tenantId, sessionId, frame, minutes }) {
  const token = crypto.randomBytes(24).toString("base64url");
  await prisma.locationRequest.create({
    data: {
      tokenHash: hashToken(token),
      tenantId,
      sessionId,
      flowId: frame.flowId,
      version: frame.version,
      nodeId: frame.nodeId,
      expiresAt: new Date(Date.now() + minutes * 60 * 1000),
    },
  });
  return { token, url: linkUrl(token) };
}

// Returns the request when the token exists, is unused and not expired.
async function findUsable(token) {
  if (!/^[\w-]{20,64}$/.test(String(token || ""))) return null;
  const request = await prisma.locationRequest.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!request || request.usedAt || request.expiresAt < new Date()) return null;
  return request;
}

// Marks the link used exactly once, even if the agent taps Share twice.
async function consume(request) {
  const { count } = await prisma.locationRequest.updateMany({
    where: { id: request.id, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  return count === 1;
}

function parseCoordinates(body = {}) {
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const accuracy = body.accuracy === undefined || body.accuracy === null ? null : Number(body.accuracy);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) return null;
  if (accuracy !== null && (!Number.isFinite(accuracy) || accuracy < 0)) return null;
  return { latitude, longitude, accuracy: accuracy === null ? null : Math.round(accuracy) };
}

module.exports = { createLink, findUsable, consume, parseCoordinates, hashToken, linkUrl };
