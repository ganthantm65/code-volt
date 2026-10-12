import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';

export async function getContestLeaderboard(req, res) {
  try {
    const contestId = req.params.contest_id || req.query.contest_id || 1;

    // Fetch ranked teams with their scores
    const result = await pool.query(
      `SELECT 
         t.id AS team_id,
         t.team_name,
         t.college,
         COALESCE(ts.total_score, 0) AS total_points,
         COALESCE(ts.total_score, 0) AS total_score,
         ts.last_submission_time
       FROM teams t
       LEFT JOIN team_scores ts ON ts.team_id = t.id AND ts.contest_id = $1
       WHERE t.contest_id = $1 OR ts.contest_id = $1 OR t.contest_id IS NULL
       ORDER BY total_points DESC, ts.last_submission_time ASC NULLS LAST, t.id ASC`,
      [contestId]
    );

    res.json({
      contest_id: Number(contestId),
      leaderboard: result.rows
    });
  } catch (err) {
    console.error('Leaderboard query error:', err);
    res.status(500).json({ error: err.message });
  }
}