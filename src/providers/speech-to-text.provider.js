const env = require("../config/env");
const { MEDIA_REF_PREFIX } = require("../utils/whatsapp-cloud-inbound");

// Groq Whisper accepts: flac, mp3, mp4, mpeg, mpga, m4a, ogg, opus, wav, webm
const EXT_BY_MIME = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg", // WhatsApp voice notes are ogg/opus
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "audio/flac": "flac",
};

class SpeechToTextProvider {
  async transcribe() {
    throw new Error("SpeechToTextProvider.transcribe must be implemented by a concrete provider.");
  }
}

// Only used when STT_PROVIDER=mock (local testing). Never a silent fallback.
class MockSpeechToTextProvider extends SpeechToTextProvider {
  async transcribe(input = {}) {
    const transcript =
      typeof input.transcript === "string" && input.transcript.trim()
        ? input.transcript
        : "Visited ABC Traders today. Met Ravi Kumar. They need 50 bags of OPC cement and want a quotation by Friday.";
    return {
      text: transcript,
      language: input.language || "en",
      duration_seconds: input.duration_seconds || 24.3,
      provider: "mock",
      model: "mock-stt-model",
      processed_at: new Date().toISOString(),
    };
  }
}

async function downloadMedia(url) {
  // Meta Cloud API voice notes arrive as a media ID; resolve + download through the Graph API.
  if (String(url).startsWith(MEDIA_REF_PREFIX)) {
    const { downloadMedia: downloadWhatsAppMedia } = require("../services/whatsapp-cloud.service");
    const buffer = await downloadWhatsAppMedia(String(url).slice(MEDIA_REF_PREFIX.length));
    if (!buffer.length) throw new Error("Downloaded audio is empty.");
    return buffer;
  }

  const headers = {};
  // Twilio media URLs are protected: Basic auth with account credentials.
  if (/twilio\.com/i.test(url) && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    headers.Authorization =
      "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  }

  const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!res.ok) {
    throw new Error(`Failed to download audio from Twilio: HTTP ${res.status}`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error("Downloaded audio is empty.");
  return buffer;
}

// "en-IN" -> "en". Returns undefined so the model auto-detects.
function toLanguageCode(language) {
  if (!language) return undefined;
  return String(language).split(/[-_]/)[0].toLowerCase();
}

function prepareAudio(input) {
  const mediaUrl = input.url || input.mediaUrl;
  if (!mediaUrl) throw new Error("No audio URL was provided for transcription.");
  const mimeType = String(input.mimeType || "audio/ogg").split(";")[0].trim().toLowerCase();
  const ext = EXT_BY_MIME[mimeType] || "ogg";
  return { mediaUrl, mimeType, fileName: `voice-${Date.now()}.${ext}` };
}

class GroqSpeechToTextProvider extends SpeechToTextProvider {
  async transcribe(input = {}) {
    if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set.");

    const { mediaUrl, mimeType, fileName } = prepareAudio(input);
    const audioBuffer = await downloadMedia(mediaUrl);
    const model = env.GROQ_STT_MODEL || "whisper-large-v3-turbo";

    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: mimeType }), fileName);
    formData.append("model", model);
    formData.append("response_format", "verbose_json");
    formData.append("temperature", "0");
    const lang = toLanguageCode(input.language);
    if (lang) formData.append("language", lang);
    // Optional hint that improves domain words / names (max ~224 tokens)
    if (env.STT_PROMPT) formData.append("prompt", env.STT_PROMPT);

    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`Groq transcription failed: ${response.status} ${bodyText}`);
    }

    const payload = await response.json();
    const text = String(payload.text || "").trim();
    if (!text) throw new Error("Transcription returned no text.");

    console.log(`[STT/groq] (${payload.language || "?"}) ${text}`);

    return {
      text,
      language: payload.language || lang || "unknown",
      duration_seconds: Number(payload.duration) || 0,
      provider: "groq",
      model,
      processed_at: new Date().toISOString(),
    };
  }
}

class ElevenLabsSpeechToTextProvider extends SpeechToTextProvider {
  async transcribe(input = {}) {
    if (!env.ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set.");

    const { mediaUrl, mimeType, fileName } = prepareAudio(input);
    const audioBuffer = await downloadMedia(mediaUrl);

    const formData = new FormData();
    formData.append("file", new Blob([audioBuffer], { type: mimeType }), fileName);
    formData.append("model_id", env.ELEVENLABS_STT_MODEL || "scribe_v1");
    const lang = toLanguageCode(input.language);
    if (lang) formData.append("language_code", lang);

    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
      body: formData,
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const bodyText = await response.text();
      throw new Error(`ElevenLabs transcription failed: ${response.status} ${bodyText}`);
    }

    const payload = await response.json();
    const text = (payload.text || payload.transcript || "").trim();
    if (!text) throw new Error("Transcription returned no text.");

    const words = Array.isArray(payload.words) ? payload.words : [];
    const duration = words.length ? Number(words[words.length - 1].end) || 0 : 0;

    console.log(`[STT/elevenlabs] (${payload.language_code || "?"}) ${text}`);

    return {
      text,
      language: payload.language_code || lang || "unknown",
      duration_seconds: duration,
      provider: "elevenlabs",
      model: env.ELEVENLABS_STT_MODEL || "scribe_v1",
      processed_at: new Date().toISOString(),
    };
  }
}

function createSpeechToTextProvider() {
  const providerName = String(env.STT_PROVIDER || "groq").toLowerCase();
  if (providerName === "mock") return new MockSpeechToTextProvider();
  if (providerName === "groq") return new GroqSpeechToTextProvider();
  if (providerName === "elevenlabs") return new ElevenLabsSpeechToTextProvider();
  throw new Error(`Unknown STT_PROVIDER: ${providerName}`);
}

module.exports = {
  SpeechToTextProvider,
  MockSpeechToTextProvider,
  GroqSpeechToTextProvider,
  ElevenLabsSpeechToTextProvider,
  createSpeechToTextProvider,
};