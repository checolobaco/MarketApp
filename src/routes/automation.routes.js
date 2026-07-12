import express from "express";
import {
  getAutomationState,
  updateAutomationState
} from "../scheduler/automationState.js";
import { getStoredAutomationConfig } from "../services/automationDb.js";

const router = express.Router();

// GET /api/automation — Lee el estado actual en memoria
router.get("/automation", (req, res) => {
  res.json({
    ok: true,
    automation: getAutomationState()
  });
});

// GET /api/automation/stored — Lee el estado directamente desde la base de datos
router.get("/automation/stored", async (req, res) => {
  try {
    const stored = await getStoredAutomationConfig();
    res.json({ ok: true, stored });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// PATCH /api/automation — Actualiza uno o más valores del estado y los persiste
router.patch("/automation", (req, res) => {
  try {
    const automation = updateAutomationState(req.body);
    res.json({ ok: true, automation });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

export default router;
