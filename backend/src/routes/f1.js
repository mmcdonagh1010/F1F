import express from "express";
import { getLiveDriverDetail, getLiveF1Snapshot, getLiveTeamDetail } from "../services/f1Live.js";
import { getMediaOverrides } from "../services/settings.js";

const router = express.Router();

router.get("/live", async (req, res, next) => {
  try {
    const data = await getLiveF1Snapshot(req.query.season);
    return res.json(data);
  } catch (error) {
    return next(error);
  }
});

router.get("/media-overrides", async (_req, res, next) => {
  try {
    const overrides = await getMediaOverrides();
    return res.json(overrides);
  } catch (error) {
    return next(error);
  }
});

router.get("/live/drivers/:driverId", async (req, res, next) => {
  try {
    const data = await getLiveDriverDetail(req.params.driverId, req.query.season);
    return res.json(data);
  } catch (error) {
    if (error.message === "Driver not found") {
      return res.status(404).json({ error: error.message });
    }
    return next(error);
  }
});

router.get("/live/teams/:teamId", async (req, res, next) => {
  try {
    const data = await getLiveTeamDetail(req.params.teamId, req.query.season);
    return res.json(data);
  } catch (error) {
    if (error.message === "Team not found") {
      return res.status(404).json({ error: error.message });
    }
    return next(error);
  }
});

export default router;