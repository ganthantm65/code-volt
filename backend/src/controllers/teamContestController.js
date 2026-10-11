import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';
import { redis } from '../config/redis.js';
import { evaluateSubmissionLive } from '../services/validatorService.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secure_code_shock_jwt_key_2026';

export async function registerTeam(req, res) {
  const { team_name, member_one_name, member_two_name, college, year } = req.body;

  if (!team_name || !member_one_name || !member_two_name || !college) {
    return res.status(400).json({ error: 'All team registration fields are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO teams (team_name, member_one_name, member_two_name, college, year)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, team_name, college`,
      [team_name, member_one_name, member_two_name, college, year || null]
    );

    res.status(201).json({ message: 'Team registered successfully', team: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.detail || 'Team name already exists' });
  }
}

export async function loginTeamWithAccessCode(req, res) {
  const { team_name, access_code } = req.body;

  try {
    const contestRes = await pool.query(
      'SELECT * FROM contests WHERE access_code = $1',
      [access_code.toUpperCase()]
    );
    const contest = contestRes.rows[0];

    if (!contest) return res.status(404).json({ error: 'Invalid Contest Access Code' });
    if (!contest.is_active) return res.status(403).json({ error: 'Contest is not active yet' });

    const teamRes = await pool.query('SELECT * FROM teams WHERE team_name = $1', [team_name]);
    const team = teamRes.rows[0];

    if (!team) return res.status(404).json({ error: 'Team is not registered' });
    if (team.is_disqualified) return res.status(403).json({ error: 'Team is disqualified' });

    const token = jwt.sign(
      { id: team.id, team_name: team.team_name, role: 'team' },
      JWT_SECRET,
      { expiresIn: '3h' }
    );

    res.json({
      token,
      contest_id: contest.id,
      team: { id: team.id, team_name: team.team_name, contest_id: contest.id }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function joinContest(req, res) {
  const teamId = req.user.id;
  const { contest_id } = req.body;

  try {
    const contestRes = await pool.query('SELECT * FROM contests WHERE id = $1', [contest_id]);
    const contest = contestRes.rows[0];

    if (!contest || !contest.is_active) {
      return res.status(403).json({ error: 'Contest is not active' });
    }

    const duration = contest.duration_minutes || 15;
    const updateTeam = await pool.query(
      `UPDATE teams 
       SET contest_id = $1, 
           joined_at = NOW(), 
           start_time = COALESCE(start_time, NOW()), 
           end_time = COALESCE(end_time, NOW() + ($2 || ' minutes')::INTERVAL)
       WHERE id = $3
       RETURNING id, team_name, contest_id, start_time, end_time, is_finished`,
      [contest.id, duration, teamId]
    );

    await pool.query(
      `INSERT INTO team_scores (team_id, contest_id) VALUES ($1, $2)
       ON CONFLICT (team_id) DO UPDATE SET contest_id = EXCLUDED.contest_id`,
      [teamId, contest.id]
    );

    res.json({
      message: `Joined contest successfully! ${duration}-minute countdown is running.`,
      team: updateTeam.rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getContestChallenges(req, res) {
  const teamId = req.user.id;

  try {
    const teamRes = await pool.query('SELECT contest_id FROM teams WHERE id = $1', [teamId]);
    const contestId = teamRes.rows[0]?.contest_id;

    if (!contestId) return res.status(400).json({ error: 'Please join a contest first' });

    const result = await pool.query(
      `SELECT id, challenge_number, title, description, challenge_type, max_points, penalty_per_resubmit, supported_languages, content_payload 
       FROM challenges 
       WHERE contest_id = $1 
       ORDER BY challenge_number ASC`,
      [contestId]
    );

    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function submitChallenge(req, res) {
  const teamId = req.user.id;
  const { challenge_id, submission_payload } = req.body;

  try {
    const teamRes = await pool.query('SELECT * FROM teams WHERE id = $1', [teamId]);
    const team = teamRes.rows[0];

    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (team.is_finished) return res.status(400).json({ error: 'Contest already marked as complete' });

    const now = new Date();
    if (now.getTime() > new Date(team.end_time).getTime() + 5000) {
      return res.status(403).json({ error: '15-minute time limit expired' });
    }

    const solvedRes = await pool.query(
      'SELECT id FROM submissions WHERE team_id = $1 AND challenge_id = $2 AND is_correct = TRUE',
      [teamId, challenge_id]
    );
    if (solvedRes.rows.length > 0) return res.status(400).json({ error: 'Challenge already solved!' });

    const chalRes = await pool.query('SELECT * FROM challenges WHERE id = $1', [challenge_id]);
    const challenge = chalRes.rows[0];
    if (!challenge) return res.status(404).json({ error: 'Challenge not found' });

    const attemptsRes = await pool.query(
      'SELECT COUNT(*) FROM submissions WHERE team_id = $1 AND challenge_id = $2',
      [teamId, challenge_id]
    );
    const priorAttempts = parseInt(attemptsRes.rows[0].count, 10);

    // Run real execution inside Docker Sandbox
    const evalResult = await evaluateSubmissionLive(challenge, submission_payload);

    let pointsAwarded = 0;
    if (evalResult.is_correct) {
      const penalty = priorAttempts * challenge.penalty_per_resubmit;
      pointsAwarded = Math.max(challenge.max_points - penalty, 20);
    }

    await pool.query(
      `INSERT INTO submissions (
        contest_id, team_id, challenge_id, submitted_payload,
        is_correct, points_awarded, test_cases_passed, total_test_cases
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        team.contest_id,
        teamId,
        challenge_id,
        JSON.stringify(submission_payload),
        evalResult.is_correct,
        pointsAwarded,
        evalResult.test_cases_passed,
        evalResult.total_test_cases
      ]
    );

    if (evalResult.is_correct) {
      const scoreUpdate = await pool.query(
        `UPDATE team_scores 
         SET total_score = total_score + $1,
             solved_count = solved_count + 1,
             last_submission_time = NOW()
         WHERE team_id = $2
         RETURNING total_score`,
        [pointsAwarded, teamId]
      );

      const newTotal = scoreUpdate.rows[0].total_score;
      await redis.zadd(`leaderboard:${team.contest_id}`, newTotal, teamId.toString());
    }

    res.json({
      correct: evalResult.is_correct,
      points_awarded: pointsAwarded,
      test_cases_passed: evalResult.test_cases_passed,
      total_test_cases: evalResult.total_test_cases,
      feedback: evalResult.feedback,
      execution_logs: evalResult.logs
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function completeContest(req, res) {
  const teamId = req.user.id;

  try {
    await pool.query('UPDATE teams SET is_finished = TRUE WHERE id = $1', [teamId]);
    res.json({ message: 'Contest finalized! Great job. Check final leaderboard standings.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}