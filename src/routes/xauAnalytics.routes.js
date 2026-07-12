import express from "express";
import { pool } from "../db.js";

const router = express.Router();

router.get("/xau/scalp/stats/by-session", async (req, res) => {
  await groupedStats(req, res, "session_name");
});

router.get("/xau/scalp/stats/by-quality", async (req, res) => {
  await groupedStats(req, res, "trade_quality");
});

router.get("/xau/scalp/stats/by-adx", async (req, res) => {
  await groupedStats(req, res, "adx_signal");
});

router.get("/xau/scalp/stats/by-atr", async (req, res) => {
  await groupedStats(req, res, "atr_signal");
});

router.get("/xau/scalp/stats/by-hour", async (req, res) => {
  await groupedStats(req, res, "prediction_hour");
});

router.get("/xau/scalp/stats/tpsl", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        first_hit,

        COUNT(*)::int AS total,

        ROUND(AVG(real_pips_result), 2) AS avg_real_pips,

        ROUND(SUM(real_pips_result), 2) AS total_real_pips,

        SUM(CASE WHEN real_pips_result > 0 THEN 1 ELSE 0 END)::int AS positive_trades,

        SUM(CASE WHEN real_pips_result < 0 THEN 1 ELSE 0 END)::int AS negative_trades,

        ROUND(
          SUM(CASE WHEN real_pips_result > 0 THEN 1 ELSE 0 END)::numeric
          / COUNT(*) * 100,
          2
        ) AS real_win_rate,

        ROUND(AVG(minutes_to_first_hit), 2) AS avg_minutes_to_first_hit

      FROM scalp_results
      WHERE first_hit IS NOT NULL
      GROUP BY first_hit
      ORDER BY total_real_pips DESC
      `
    );

    res.json({
      ok: true,
      stats: rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/xau/scalp/stats/tpsl-by-hour", async (req, res) => {
  await groupedTpSlStats(req, res, "prediction_hour");
});

router.get("/xau/scalp/stats/tpsl-by-quality", async (req, res) => {
  await groupedTpSlStats(req, res, "trade_quality");
});

router.get("/xau/scalp/stats/tpsl-by-session", async (req, res) => {
  await groupedTpSlStats(req, res, "session_name");
});

router.get("/xau/scalp/stats/tpsl-by-adx", async (req, res) => {
  await groupedTpSlStats(req, res, "adx_signal");
});

router.get("/xau/scalp/stats/tpsl-by-atr", async (req, res) => {
  await groupedTpSlStats(req, res, "atr_signal");
});

async function groupedStats(req, res, groupColumn) {
  try {
    const allowed = [
      "session_name",
      "trade_quality",
      "adx_signal",
      "atr_signal",
      "prediction_hour"
    ];

    if (!allowed.includes(groupColumn)) {
      return res.status(400).json({
        ok: false,
        error: "Grupo no permitido"
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        ${groupColumn} AS group_value,

        COUNT(*)::int AS total,

        SUM(CASE WHEN result_type = 'WIN' THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN result_type = 'LOSS' THEN 1 ELSE 0 END)::int AS losses,
        SUM(CASE WHEN result_type = 'NEUTRAL' THEN 1 ELSE 0 END)::int AS neutrals,

        ROUND(
          SUM(CASE WHEN result_type = 'WIN' THEN 1 ELSE 0 END)::numeric
          / COUNT(*) * 100,
          2
        ) AS win_rate,

        ROUND(AVG(pips_result), 2) AS avg_pips,
        ROUND(SUM(pips_result), 2) AS total_pips,

        ROUND(AVG(real_pips_result), 2) AS avg_real_pips,
        ROUND(SUM(real_pips_result), 2) AS total_real_pips,

        ROUND(AVG(max_gain_pips), 2) AS avg_max_gain_pips,
        ROUND(AVG(max_loss_pips), 2) AS avg_max_loss_pips,

        ROUND(AVG(minutes_to_first_hit), 2) AS avg_minutes_to_first_hit

      FROM scalp_results
      WHERE ${groupColumn} IS NOT NULL
      GROUP BY ${groupColumn}
      ORDER BY total_real_pips DESC NULLS LAST
      `
    );

    res.json({
      ok: true,
      group_by: groupColumn,
      stats: rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}

async function groupedTpSlStats(req, res, groupColumn) {
  try {
    const allowed = [
      "prediction_hour",
      "trade_quality",
      "session_name",
      "adx_signal",
      "atr_signal"
    ];

    if (!allowed.includes(groupColumn)) {
      return res.status(400).json({
        ok: false,
        error: "Grupo no permitido"
      });
    }

    const { rows } = await pool.query(
      `
      SELECT
        ${groupColumn} AS group_value,
        first_hit,

        COUNT(*)::int AS total,

        ROUND(AVG(real_pips_result), 2) AS avg_real_pips,

        ROUND(SUM(real_pips_result), 2) AS total_real_pips,

        SUM(CASE WHEN real_pips_result > 0 THEN 1 ELSE 0 END)::int AS positive_trades,

        SUM(CASE WHEN real_pips_result < 0 THEN 1 ELSE 0 END)::int AS negative_trades,

        ROUND(
          SUM(CASE WHEN real_pips_result > 0 THEN 1 ELSE 0 END)::numeric
          / COUNT(*) * 100,
          2
        ) AS real_win_rate,

        ROUND(AVG(minutes_to_first_hit), 2) AS avg_minutes_to_first_hit

      FROM scalp_results
      WHERE first_hit IS NOT NULL
      GROUP BY ${groupColumn}, first_hit
      ORDER BY group_value ASC, total_real_pips DESC
      `
    );

    res.json({
      ok: true,
      group_by: groupColumn,
      stats: rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
}

router.get("/xau/scalp/stats/by-smart-filter", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `
      SELECT
        sp.smart_allowed,

        COUNT(*)::int AS total,

        SUM(CASE WHEN sr.result_type = 'WIN' THEN 1 ELSE 0 END)::int AS wins,
        SUM(CASE WHEN sr.result_type = 'LOSS' THEN 1 ELSE 0 END)::int AS losses,
        SUM(CASE WHEN sr.result_type = 'NEUTRAL' THEN 1 ELSE 0 END)::int AS neutrals,

        ROUND(
          SUM(CASE WHEN sr.result_type = 'WIN' THEN 1 ELSE 0 END)::numeric
          / COUNT(*) * 100,
          2
        ) AS win_rate,

        ROUND(AVG(sr.real_pips_result), 2) AS avg_real_pips,
        ROUND(SUM(sr.real_pips_result), 2) AS total_real_pips,

        ROUND(AVG(sr.minutes_to_first_hit), 2) AS avg_minutes_to_first_hit

      FROM scalp_results sr
      JOIN scalp_predictions sp
        ON sp.id = sr.scalp_prediction_id
      GROUP BY sp.smart_allowed
      ORDER BY total_real_pips DESC
      `
    );

    res.json({
      ok: true,
      group_by: "smart_allowed",
      stats: rows
    });

  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

router.get("/analytics/api-usage", async (req, res) => {
  try {
    const { rows: stats } = await pool.query(
      `
      SELECT
        provider,
        COUNT(*)::int AS total_requests,
        SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END)::int AS success_count,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END)::int AS failure_count,
        ROUND(
          SUM(CASE WHEN status = 'SUCCESS' THEN 1 ELSE 0 END)::numeric / COUNT(*) * 100,
          2
        ) AS success_rate_percent,
        ROUND(AVG(response_time_ms), 2) AS avg_response_time_ms,
        MIN(response_time_ms) AS min_response_time_ms,
        MAX(response_time_ms) AS max_response_time_ms
      FROM api_logs
      GROUP BY provider
      ORDER BY total_requests DESC
      `
    );

    const { rows: recentErrors } = await pool.query(
      `
      SELECT timestamp, provider, symbol, request_type, error_message
      FROM api_logs
      WHERE status = 'FAILED'
      ORDER BY timestamp DESC
      LIMIT 10
      `
    );

    res.json({
      ok: true,
      stats,
      recent_errors: recentErrors
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message
    });
  }
});

export default router;
