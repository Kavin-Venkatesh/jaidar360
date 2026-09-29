const express = require("express");
const { getGeoCapture, postGeoCapture } = require("../controllers/location.controller");

const router = express.Router();

router.get("/geo/capture", getGeoCapture);
router.post("/geo/capture", postGeoCapture);

module.exports = router;
