const crypto = require("crypto");
const express = require("express");
const jwt = require("jsonwebtoken");
const { z } = require("zod");
const env = require("../config/env");
const users = require("../config/users");
const tenants = require("../config/tenants");

const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });

function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

function publicTenant(tenant) {
  return {
    id: tenant.id,
    name: tenant.name,
    whatsappNumber: tenant.whatsapp.displayNumber,
    whatsappConnected: Boolean(tenant.whatsapp.phoneNumberId && tenant.whatsapp.accessToken),
    agents: tenant.agents.map((a) => ({ id: a.id, name: a.name, team: a.team, registered: Boolean(a.phone) })),
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.username, tenantId: user.tenantId, name: user.name }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });
}

function readToken(req) {
  const header = String(req.get("authorization") || "");
  if (header.startsWith("Bearer ")) return header.slice(7);
  // Plain <a href> / <img src> links (submission media) can't send headers.
  if (req.method === "GET" && typeof req.query.token === "string") return req.query.token;
  return null;
}

// Every /api route uses this; tenantId only ever comes from the signed token, never from the request.
function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ message: "Sign in required" });
  try {
    const claims = jwt.verify(token, env.JWT_SECRET);
    const tenant = tenants.byId(claims.tenantId);
    if (!tenant) return res.status(401).json({ message: "Unknown tenant" });
    req.user = { username: claims.sub, name: claims.name };
    req.tenantId = tenant.id;
    req.tenant = tenant;
    return next();
  } catch {
    return res.status(401).json({ message: "Session expired, sign in again" });
  }
}

const router = express.Router();

router.post("/auth/login", (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: "Username and password are required" });
  const { username, password } = parsed.data;
  const user = users.find((u) => u.username === username);
  // Compare against a dummy when the user doesn't exist so timing doesn't reveal valid usernames.
  const ok = safeEqual(password, user ? user.password : "\u0000invalid") && Boolean(user);
  if (!ok) return res.status(401).json({ message: "Invalid username or password" });
  const tenant = tenants.byId(user.tenantId);
  return res.json({
    token: signToken(user),
    user: { username: user.username, name: user.name },
    tenant: publicTenant(tenant),
  });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: req.user, tenant: publicTenant(req.tenant) });
});

module.exports = { router, requireAuth, signToken, publicTenant };
