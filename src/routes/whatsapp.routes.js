const express = require("express");
const router = express.Router();
const conversationService = require("../services/conversation.service");

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

module.exports = router;