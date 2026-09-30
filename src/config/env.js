require("dotenv").config();

const env = {
  PORT: Number(process.env.PORT || 3000),
  NODE_ENV: process.env.NODE_ENV || "development",
  // "twilio" or "whatsapp" (Meta WhatsApp Cloud API). Decides who sends outbound messages.
  MESSAGING_PROVIDER: (process.env.MESSAGING_PROVIDER || "twilio").toLowerCase(),
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN || "",
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
  WHATSAPP_VERIFY_TOKEN: process.env.WHATSAPP_VERIFY_TOKEN || "",
  WHATSAPP_APP_SECRET: process.env.WHATSAPP_APP_SECRET || "",
  WHATSAPP_GRAPH_API_VERSION: process.env.WHATSAPP_GRAPH_API_VERSION || "v23.0",
  DISABLE_WHATSAPP_VALIDATION: process.env.DISABLE_WHATSAPP_VALIDATION === "true",
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || "",
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || "",
  TWILIO_WHATSAPP_NUMBER: process.env.TWILIO_WHATSAPP_NUMBER || "whatsapp:+14155238886",
  TWILIO_MOCK_MODE: process.env.TWILIO_MOCK_MODE === "true",
  TWILIO_ENABLE_LIVE: process.env.TWILIO_ENABLE_LIVE === "true",
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || "http://localhost:3000",
  CONTENT_MAIN_MENU: process.env.CONTENT_MAIN_MENU || "",
  CONTENT_VISIT_LOCATION: process.env.CONTENT_VISIT_LOCATION || "",
  CONTENT_MEETING_DRAFT_ACTIONS: process.env.CONTENT_MEETING_DRAFT_ACTIONS || "",
  CONTENT_CHECK_IN_LOCATION: process.env.CONTENT_CHECK_IN_LOCATION || "",
  CONTENT_POST_CHECKIN_MENU: process.env.CONTENT_POST_CHECKIN_MENU || "",
  CONTENT_COMPANY_NAME: process.env.CONTENT_COMPANY_NAME || "",
  CONTENT_CONTACT_NAME: process.env.CONTENT_CONTACT_NAME || "",
  CONTENT_PHONE: process.env.CONTENT_PHONE || "",
  CONTENT_INDUSTRY_GROUP: process.env.CONTENT_INDUSTRY_GROUP || "",
  CONTENT_INDUSTRY: process.env.CONTENT_INDUSTRY || "",
  CONTENT_DISCUSSION: process.env.CONTENT_DISCUSSION || "",
  CONTENT_MEETING_OUTCOME: process.env.CONTENT_MEETING_OUTCOME || "",
  CONTENT_PROSPECT_TEMPERATURE: process.env.CONTENT_PROSPECT_TEMPERATURE || "",
  AWS_REGION: process.env.AWS_REGION || "ap-south-1",
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET || "jaidar-whatsapp-assets",
  LOCATION_IMAGE_URL: process.env.S3_LOCATION_IMAGE_URL || process.env.WHATSAPP_LOCATION_IMAGE_URL || "https://jaidar-whatsapp-assets.s3.ap-south-1.amazonaws.com/whatsapp/location.png",
  LOCATION_TOKEN_TTL_SECONDS: Number(process.env.LOCATION_TOKEN_TTL_SECONDS || 300),
  BUSINESS_TIMEZONE: process.env.BUSINESS_TIMEZONE || "Asia/Kolkata",
  REGISTERED_WHATSAPP_NUMBERS: (process.env.REGISTERED_WHATSAPP_NUMBERS || "whatsapp:+14155238886").split(",").map((value) => value.trim()).filter(Boolean),
  DISABLE_TWILIO_VALIDATION: process.env.DISABLE_TWILIO_VALIDATION === "true",
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "",
  ELEVENLABS_STT_MODEL: process.env.ELEVENLABS_STT_MODEL || "scribe_v1",
  DRAFT_EXPIRATION_HOURS: Number(process.env.DRAFT_EXPIRATION_HOURS || 24),
  GROQ_API_KEY: process.env.GROQ_API_KEY,
  GROQ_MODEL: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
  GROQ_STT_MODEL: process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo",
  LLM_PROVIDER: process.env.LLM_PROVIDER || "groq",
  STT_PROVIDER: process.env.STT_PROVIDER || "groq",
  STT_PROMPT: process.env.STT_PROMPT,

  // Canvas flow builder
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET || "",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "12h",
  FLOW_SESSION_IDLE_MINUTES: Number(process.env.FLOW_SESSION_IDLE_MINUTES || 60),
  FLOW_SESSION_TIMEOUT_NOTICE: process.env.FLOW_SESSION_TIMEOUT_NOTICE !== "false",
  UPLOADS_DIR: process.env.UPLOADS_DIR || "uploads",
};

// Prisma reads DATABASE_URL straight from process.env.
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL = "file:./dev.db";

if (!env.JWT_SECRET) {
  if (env.NODE_ENV === "production") throw new Error("JWT_SECRET must be set in production.");
  env.JWT_SECRET = "dev-only-jwt-secret";
}

module.exports = env;
