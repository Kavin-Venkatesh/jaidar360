// /api/* for the canvas flow builder. Everything except login requires a tenant JWT.
const express = require("express");
const auth = require("./auth/auth");
const flowRoutes = require("./flows/flow.routes");
const submissionRoutes = require("./submissions/submission.routes");
const { logError } = require("./utils/logger");

const router = express.Router();

router.use(auth.router);
router.use(auth.requireAuth);
router.use(flowRoutes);
router.use(submissionRoutes);

router.use((req, res) => res.status(404).json({ message: "Not found" }));

// eslint-disable-next-line no-unused-vars
router.use((error, req, res, next) => {
  if (error.status && error.body) return res.status(error.status).json(error.body);
  if (error.type === "entity.parse.failed") return res.status(400).json({ message: "Invalid JSON" });
  logError("API_ERROR", error, { path: req.path });
  return res.status(500).json({ message: "Something went wrong" });
});

module.exports = router;
