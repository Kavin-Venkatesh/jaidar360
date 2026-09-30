const { randomUUID } = require("crypto");

const agents = new Map();
const conversations = new Map();
const processedInboundMessages = new Map();
const locationTokens = new Map();
const checkIns = new Map();
const customerVisits = new Map();
const followUps = new Map();
const auditLogs = [];

const defaultAgents = [
  {
    id: "agent-1",
    name: "Demo Sales Agent",
    whatsappNumber: "whatsapp:+14155238886",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "agent-2",
    name: "Field Agent",
    whatsappNumber: "whatsapp:+919000000000",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "agent-3",
    name: "Sales Manager",
    whatsappNumber: "whatsapp:+917904863284",
    isActive: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "agent-4",
    name: "Support Agent",
    whatsappNumber: "whatsapp:+919994823789",
    isActive: true,
    createdAt: new Date().toISOString(),
  }
];

defaultAgents.forEach((agent) => {
  const normalized = normalizePhoneNumber(agent.whatsappNumber);
  agents.set(normalized, {
    ...agent,
    whatsappNumber: normalized,
  });
});

function normalizePhoneNumber(phoneNumber) {
  if (!phoneNumber) return "";

  let value = String(phoneNumber).trim();
  value = value.replace(/\s+/g, "");

  if (value.toLowerCase().startsWith("whatsapp:")) {
    value = value.slice("whatsapp:".length);
  }

  value = value.replace(/^whatsapp/i, "");
  value = value.replace(/[^\d+]/g, "");

  if (!value) return "";

  if (value.startsWith("+")) {
    return value;
  }

  if (/^\d+$/.test(value)) {
    return `+${value}`;
  }

  return value;
}

function upsertAgent(agent) {
  const whatsappNumber = normalizePhoneNumber(agent.whatsappNumber);
  const record = {
    id: agent.id || randomUUID(),
    name: agent.name || "Agent",
    whatsappNumber,
    isActive: agent.isActive !== false,
    createdAt: agent.createdAt || new Date().toISOString(),
  };
  agents.set(whatsappNumber, record);
  return record;
}

function getAgentByPhone(phoneNumber) {
  const normalized = normalizePhoneNumber(phoneNumber);
  return agents.get(normalized) || null;
}

function getOrCreateConversation(phoneNumber, agentId = null) {
  const normalized = normalizePhoneNumber(phoneNumber);
  console.log(`getOrCreateConversation: normalized=${normalized}, agentId=${agentId}`);
  let conversation = conversations.get(normalized);

  if (!conversation) {
    conversation = {
      id: randomUUID(),
      agentId,
      whatsappNumber: normalized,
      currentState: "START",
      stateVersion: 0,
      activeVisitId: null,
      status: "ACTIVE",
      history: [],
      data: {},
      lastInboundMessageAt: new Date().toISOString(),
      lastOutboundMessageAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    conversations.set(normalized, conversation);
  }

  return conversation;
}

function updateConversation(phoneNumber, updates) {
  const normalized = normalizePhoneNumber(phoneNumber);
  const conversation = conversations.get(normalized);
  if (!conversation) return null;

  const nextConversation = {
    ...conversation,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  conversations.set(normalized, nextConversation);
  return nextConversation;
}

function getConversationByPhone(phoneNumber) {
  return conversations.get(normalizePhoneNumber(phoneNumber)) || null;
}

function createVisit(visitData) {
  const visit = {
    id: visitData.id || randomUUID(),
    agentId: visitData.agentId,
    customerId: visitData.customerId || randomUUID(),
    companyName: visitData.companyName || null,
    contactName: visitData.contactName || null,
    contactMobile: visitData.contactMobile || null,
    industryGroup: visitData.industryGroup || null,
    industry: visitData.industry || null,
    discussionType: visitData.discussionType || null,
    discussionNotes: visitData.discussionNotes || null,
    meetingOutcome: visitData.meetingOutcome || null,
    prospectTemperature: visitData.prospectTemperature || null,
    checkInLatitude: visitData.checkInLatitude || null,
    checkInLongitude: visitData.checkInLongitude || null,
    checkInAccuracy: visitData.checkInAccuracy || null,
    checkInAt: visitData.checkInAt || null,
    visitLatitude: visitData.visitLatitude || null,
    visitLongitude: visitData.visitLongitude || null,
    visitAccuracy: visitData.visitAccuracy || null,
    visitAt: visitData.visitAt || null,
    status: visitData.status || "DRAFT",
    createdAt: visitData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  customerVisits.set(visit.id, visit);
  return visit;
}

function getVisitById(visitId) {
  return customerVisits.get(visitId) || null;
}

function saveCheckIn(checkIn) {
  const record = {
    id: checkIn.id || randomUUID(),
    agentId: checkIn.agentId,
    whatsappNumber: checkIn.whatsappNumber,
    conversationId: checkIn.conversationId,
    latitude: checkIn.latitude,
    longitude: checkIn.longitude,
    accuracy: checkIn.accuracy,
    capturedAt: checkIn.capturedAt || new Date().toISOString(),
    source: checkIn.source || "browser",
    createdAt: checkIn.createdAt || new Date().toISOString(),
  };

  checkIns.set(record.id, record);
  return record;
}

function createLocationToken({ type, whatsappNumber, conversationId, visitId = null, ttlMs = 300000 }) {
  const token = randomUUID().replace(/-/g, "").slice(0, 32);
  const payload = {
    token,
    type,
    whatsappNumber,
    conversationId,
    visitId,
    used: false,
    expiresAt: Date.now() + ttlMs,
    createdAt: new Date().toISOString(),
  };

  locationTokens.set(token, payload);
  return token;
}

function consumeLocationToken(token, expectedType = null) {
  const payload = locationTokens.get(token);
  if (!payload) return null;

  if (payload.used) return null;

  if (Date.now() > payload.expiresAt) {
    payload.used = true;
    locationTokens.set(token, payload);
    return null;
  }

  if (expectedType && payload.type !== expectedType) return null;

  payload.used = true;
  payload.usedAt = new Date().toISOString();
  locationTokens.set(token, payload);
  return payload;
}

function getLocationTokenRecord(token) {
  return locationTokens.get(token) || null;
}

function addAuditLog(event, actor, entity, entityId, metadata = {}) {
  const log = {
    id: randomUUID(),
    event,
    actor,
    entity,
    entityId,
    timestamp: new Date().toISOString(),
    metadata,
  };

  auditLogs.push(log);
  return log;
}

function getAuditLogs() {
  return auditLogs;
}

function markProcessedInbound(messageSid, details = {}) {
  processedInboundMessages.set(messageSid, {
    ...details,
    messageSid,
    processedAt: new Date().toISOString(),
  });
}

function hasProcessedInbound(messageSid) {
  return processedInboundMessages.has(messageSid);
}

function createFollowUp(followUp) {
  const record = {
    id: followUp.id || randomUUID(),
    visitId: followUp.visitId,
    customerId: followUp.customerId,
    agentId: followUp.agentId,
    title: followUp.title,
    description: followUp.description || "",
    dueAt: followUp.dueAt || new Date().toISOString(),
    status: followUp.status || "PENDING",
    priority: followUp.priority || "MEDIUM",
    createdAt: followUp.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  followUps.set(record.id, record);
  return record;
}

function countPendingFollowUps(agentId) {
  return [...followUps.values()].filter((followUp) => followUp.agentId === agentId && followUp.status === "PENDING").length;
}

module.exports = {
  normalizePhoneNumber,
  upsertAgent,
  getAgentByPhone,
  getOrCreateConversation,
  updateConversation,
  getConversationByPhone,
  createVisit,
  getVisitById,
  saveCheckIn,
  createLocationToken,
  consumeLocationToken,
  getLocationTokenRecord,
  addAuditLog,
  getAuditLogs,
  markProcessedInbound,
  hasProcessedInbound,
  createFollowUp,
  countPendingFollowUps,
};
