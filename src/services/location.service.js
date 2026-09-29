const crypto = require("crypto");
const env = require("../config/env");

const {
  createLocationToken,
  consumeLocationToken,
  getConversationByPhone,
  getVisitById,
  updateConversation,
  saveCheckIn,
  createVisit,
  addAuditLog,
} = require("../repositories/in-memory-store");

const twilioService = require("./twilio.service");

function generateSecureToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function createLocationTokenForType({
  type,
  whatsappNumber,
  conversationId,
  visitId = null,
}) {
  return createLocationToken({
    type,
    whatsappNumber,
    conversationId,
    visitId,
    ttlMs: Number(env.LOCATION_TOKEN_TTL_SECONDS || 300) * 1000,
  });
}

function validateLocationPayload(payload = {}) {
  const latitude = Number(payload.latitude);
  const longitude = Number(payload.longitude);
  const accuracy =
    payload.accuracy === undefined || payload.accuracy === null
      ? null
      : Number(payload.accuracy);

  const capturedAt =
    payload.capturedAt || new Date().toISOString();

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("Latitude must be between -90 and 90");
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("Longitude must be between -180 and 180");
  }

  if (
    accuracy !== null &&
    (!Number.isFinite(accuracy) || accuracy < 0)
  ) {
    throw new Error("Accuracy must be a non-negative numeric value");
  }

  return {
    latitude,
    longitude,
    accuracy,
    capturedAt,
  };
}

function buildMapsUrl(latitude, longitude) {
  return `https://www.google.com/maps?q=${encodeURIComponent(
    `${latitude},${longitude}`,
  )}`;
}

async function processCapturedLocation({
  token,
  latitude,
  longitude,
  accuracy,
  capturedAt,
  source = "browser",
}) {
  const normalizedToken = String(token || "").trim();

  if (!normalizedToken) {
    throw new Error("Location token is required");
  }

  /*
   * IMPORTANT:
   * Validate coordinates before consuming the token.
   * Otherwise a bad browser request permanently burns the token.
   */
  const safeLocation = validateLocationPayload({
    latitude,
    longitude,
    accuracy,
    capturedAt,
  });

  const tokenRecord = consumeLocationToken(normalizedToken);

  if (!tokenRecord) {
    throw new Error(
      "Location token is invalid, expired, or already used",
    );
  }

  const conversation = getConversationByPhone(
    tokenRecord.whatsappNumber,
  );

  if (!conversation) {
    throw new Error(
      "Conversation not found for location token",
    );
  }

  /*
   * Prevent a token generated for another conversation
   * from being reused against the current conversation.
   */
  if (conversation.id !== tokenRecord.conversationId) {
    throw new Error("Location token does not belong to this conversation");
  }

  const mapsUrl = buildMapsUrl(
    safeLocation.latitude,
    safeLocation.longitude,
  );

  // ---------------------------------------------------------
  // CHECK IN
  // ---------------------------------------------------------
  if (tokenRecord.type === "CHECK_IN") {
    const checkIn = saveCheckIn({
      agentId: conversation.agentId,
      whatsappNumber: tokenRecord.whatsappNumber,
      conversationId: tokenRecord.conversationId,
      latitude: safeLocation.latitude,
      longitude: safeLocation.longitude,
      accuracy: safeLocation.accuracy,
      capturedAt: safeLocation.capturedAt,
      source,
    });

    conversation.currentState = "CHECK_IN_COMPLETE";

    conversation.data.checkInId = checkIn.id;

    conversation.data.lastLocation = {
      latitude: safeLocation.latitude,
      longitude: safeLocation.longitude,
      accuracy: safeLocation.accuracy,
      capturedAt: safeLocation.capturedAt,
      mapsUrl,
    };

    updateConversation(
      tokenRecord.whatsappNumber,
      conversation,
    );

    addAuditLog(
      "CHECK_IN_LOCATION_CAPTURED",
      conversation.agentId || "unknown",
      "check_in",
      checkIn.id,
      {
        conversationId: conversation.id,
        latitude: safeLocation.latitude,
        longitude: safeLocation.longitude,
        mapsUrl,
      },
    );

    await twilioService.sendText(
      tokenRecord.whatsappNumber,
      [
        "✅ Check-in completed.",
        "",
        `Location: ${mapsUrl}`,
        "",
        `Time: ${new Date(
          safeLocation.capturedAt,
        ).toLocaleString("en-IN", {
          timeZone: env.BUSINESS_TIMEZONE,
        })}`,
        "",
        "What would you like to do next?",
      ].join("\n"),
    );

    return {
      success: true,
      type: "CHECK_IN",
      checkIn,
      location: safeLocation,
      mapsUrl,
    };
  }

  // ---------------------------------------------------------
  // CUSTOMER VISIT LOCATION
  // ---------------------------------------------------------
  if (tokenRecord.type === "VISIT_LOCATION") {
    let visit =
      getVisitById(tokenRecord.visitId) || null;

    if (!visit) {
      visit = createVisit({
        id: tokenRecord.visitId || crypto.randomUUID(),
        agentId: conversation.agentId,
        companyName:
          conversation.data.companyName || null,
        contactName:
          conversation.data.contactName || null,
        contactMobile:
          conversation.data.contactMobile || null,
        status: "IN_PROGRESS",
      });
    }

    visit.visitLatitude = safeLocation.latitude;
    visit.visitLongitude = safeLocation.longitude;
    visit.visitAccuracy = safeLocation.accuracy;
    visit.visitAt = safeLocation.capturedAt;
    visit.visitLocationUrl = mapsUrl;
    visit.updatedAt = new Date().toISOString();

    conversation.currentState =
      "NEW_VISIT_INDUSTRY_GROUP";

    conversation.data.activeVisitId = visit.id;

    conversation.data.visitLocation = {
      latitude: safeLocation.latitude,
      longitude: safeLocation.longitude,
      accuracy: safeLocation.accuracy,
      capturedAt: safeLocation.capturedAt,
      mapsUrl,
    };

    updateConversation(
      tokenRecord.whatsappNumber,
      conversation,
    );

    addAuditLog(
      "VISIT_LOCATION_CAPTURED",
      conversation.agentId || "unknown",
      "customer_visit",
      visit.id,
      {
        conversationId: conversation.id,
        latitude: safeLocation.latitude,
        longitude: safeLocation.longitude,
        mapsUrl,
      },
    );

    /*
     * THIS WAS MISSING IN YOUR CODE.
     */
    await twilioService.sendText(
      tokenRecord.whatsappNumber,
      [
        "✅ Visit location captured.",
        "",
        `Location: ${mapsUrl}`,
        ""
      ].join("\n"),
    );

    return {
      success: true,
      type: "VISIT_LOCATION",
      visit,
      location: safeLocation,
      mapsUrl,
    };
  }

  return {
    success: false,
    error: "Unsupported token type",
  };
}

module.exports = {
  generateSecureToken,
  createLocationTokenForType,
  processCapturedLocation,
  validateLocationPayload,
  buildMapsUrl,
};