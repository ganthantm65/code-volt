import { pool } from '../config/db.js';

export async function getContestLeaderboard(req, res) {
  const { contest_id } = req.params;

  try {
    const query = `
      SELECT 
        t.id AS team_id,
        t.team_name,
        t.college,
        t.is_finished,
        ts.total_score,
        ts.solved_count,
        ROUND(EXTRACT(EPOCH FROM (ts.last_submission_time - t.start_time))) AS duration_seconds,
        ts.last_submission_time
      FROM team_scores ts
      JOIN teams t ON t.id = ts.team_id
      WHERE ts.contest_id = $1 AND t.is_disqualified = FALSE
      ORDER BY ts.total_score DESC, ts.solved_count DESC, duration_seconds ASC, ts.last_submission_time ASC
      LIMIT 100;
    `;
    const result = await pool.query(query, [contest_id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve contest standings' });
  }
}