require("../config/env"); // sets the DATABASE_URL default before Prisma reads it
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const toJson = (value) => JSON.stringify(value ?? null);
const fromJson = (text, fallback = null) => {
  if (text === null || text === undefined || text === "") return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
};

const isUniqueViolation = (error) => error?.code === "P2002";

module.exports = { prisma, toJson, fromJson, isUniqueViolation };
