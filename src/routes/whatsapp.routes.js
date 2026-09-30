const express = require("express");
const router = express.Router();
const env = require("../config/env");
const conversationService = require("../services/conversation.service");
const { extractInboundMessages } = require("../utils/whatsapp-cloud-inbound");
const { validateWhatsAppCloudRequest } = require("../middleware/whatsapp-cloud-validation.middleware");
const tenants = require("../config/tenants");
const { parseWebhook } = require("../webhook/parser");
const flowEngine = require("../engine/engine");

// Twilio inbound webhook (MESSAGING_PROVIDER=twilio). Set this URL in the Twilio console.
router.post("/whatsapp", async (req, res) => {
  try {
    res.status(200).send("OK");

    setImmediate(async () => {
      try {
        console.log("Received WhatsApp webhook:", req.body);
        await conversationService.handleIncomingMessage(req.body || {});
      } catch (error) {
        console.error("Error processing incoming WhatsApp webhook:", error);
      }
    });
  } catch (error) {
    console.error("Webhook processing error:", error);
    res.status(500).json({ message: "Webhook processing failed" });
  }
});


router.get("/whatsapp-cloud", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];

  if (mode === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(String(req.query["hub.challenge"] || ""));
  }
  return res.sendStatus(403);
});

// Meta webhook. Numbers that belong to a canvas flow-builder tenant (src/config/tenants.js) go to the flow engine;
// every other number keeps using the legacy state-machine bot.
router.post("/whatsapp-cloud", validateWhatsAppCloudRequest, (req, res) => {
  res.sendStatus(200);

  setImmediate(async () => {
    for (const event of parseWebhook(req.body)) {
      if (!tenants.byPhoneNumberId(event.phoneNumberId)) continue;
      flowEngine.handleIncoming(event).catch((error) => console.error("Error processing flow-engine event:", error));
    }

    const skipPhoneNumberId = (id) => Boolean(tenants.byPhoneNumberId(id));
    for (const message of extractInboundMessages(req.body, { skipPhoneNumberId })) {
      try {
        console.log("Received WhatsApp Cloud message:", { from: message.From, type: message.MessageType });
        await conversationService.handleIncomingMessage(message);
      } catch (error) {
        console.error("Error processing WhatsApp Cloud message:", error);
      }
    }
  });
});

module.exports = router;
