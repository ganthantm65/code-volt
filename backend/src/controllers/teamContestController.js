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
  const { team_name, access_code, passcode } = req.body;
  const rawCode = access_code || passcode;

  if (!team_name || !rawCode) {
    return res.status(400).json({ error: 'Both team name and contest access code are required' });
  }

  try {
    const normalizedCode = String(rawCode).trim().toUpperCase();

    // 1. Verify contest access code
    const contestRes = await pool.query(
      'SELECT * FROM contests WHERE UPPER(TRIM(access_code)) = $1',
      [normalizedCode]
    );
    const contest = contestRes.rows[0];

    if (!contest) return res.status(404).json({ error: 'Invalid Contest Access Code' });
    if (!contest.is_active) return res.status(403).json({ error: 'Contest is not active yet' });

    // 2. Verify registered team
    const teamRes = await pool.query(
      'SELECT * FROM teams WHERE LOWER(TRIM(team_name)) = LOWER(TRIM($1))',
      [team_name]
    );
    const team = teamRes.rows[0];

    if (!team) return res.status(404).json({ error: 'Team is not registered' });
    if (team.is_disqualified) return res.status(403).json({ error: 'Team is disqualified' });

    // 3. Auto-join contest: initialize start_time, end_time, and contest_id if not present
    const duration = contest.duration_minutes || 15;
    const updateTeam = await pool.query(
      `UPDATE teams 
       SET contest_id = $1, 
           joined_at = COALESCE(joined_at, NOW()), 
           start_time = COALESCE(start_time, NOW()), 
           end_time = COALESCE(end_time, NOW() + ($2 || ' minutes')::INTERVAL)
       WHERE id = $3
       RETURNING id, team_name, college, contest_id, start_time, end_time, is_finished`,
      [contest.id, duration, team.id]
    );

    await pool.query(
      `INSERT INTO team_scores (team_id, contest_id) VALUES ($1, $2)
       ON CONFLICT (team_id) DO UPDATE SET contest_id = EXCLUDED.contest_id`,
      [team.id, contest.id]
    );

    const activeTeam = updateTeam.rows[0];

    // 4. Issue JWT
    const token = jwt.sign(
      { id: activeTeam.id, team_name: activeTeam.team_name, role: 'team' },
      JWT_SECRET,
      { expiresIn: '3h' }
    );

    res.json({
      token,
      contest_id: contest.id,
      team: activeTeam
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

    res.json({
      challenges: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function submitChallenge(req, res) {
  const teamId = req.user.id;
  const { challenge_id, submission_payload } = req.body;

  try {
    // 1. Fetch challenge and solution payload
    const challengeRes = await pool.query(
      `SELECT id, contest_id, challenge_type, max_points, penalty_per_resubmit, solution_payload, content_payload 
       FROM challenges 
       WHERE id = $1`,
      [challenge_id]
    );

    if (challengeRes.rows.length === 0) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    const challenge = challengeRes.rows[0];
    const solution = challenge.solution_payload;
    let isCorrect = false;
    let feedback = '';

    // 2. Validate JUMBLED_CODE
    if (challenge.challenge_type === 'JUMBLED_CODE') {
      const submittedOrder = submission_payload?.ordered_block_ids || [];
      const expectedOrder = solution?.correct_order || [];

      // Primary check: Direct block ID sequence comparison
      const orderMatches = 
        submittedOrder.length === expectedOrder.length &&
        submittedOrder.every((val, index) => val === expectedOrder[index]);

      if (orderMatches) {
        isCorrect = true;
        feedback = 'All blocks sequenced in correct chronological order! All hidden test cases passed.';
      } else {
        isCorrect = false;
        feedback = 'Incorrect block ordering. Review loop structure, variable assignments, and return statements.';
      }
    } 
    // 3. Validate INVALID_TEST_CASE
    else if (challenge.challenge_type === 'INVALID_TEST_CASE') {
      const submittedTcId = (submission_payload?.defective_test_case_id || '').trim();
      const submittedOutput = (submission_payload?.corrected_expected_output || '').trim();

      const expectedTcId = (solution?.defective_test_case_id || '').trim();
      const expectedOutput = (solution?.corrected_expected_output || '').trim();

      if (submittedTcId === expectedTcId && submittedOutput === expectedOutput) {
        isCorrect = true;
        feedback = `Identified defective case (${submittedTcId}) and supplied valid corrected assertion!`;
      } else {
        isCorrect = false;
        feedback = 'Defective test case ID or expected output assertion does not match expected fix.';
      }
    }

    // 4. Update team scores and submission audit log
    const pointsAwarded = isCorrect ? challenge.max_points : 0;

    await pool.query(
      `INSERT INTO submissions (team_id, challenge_id, submission_payload, is_correct, points_awarded)
       VALUES ($1, $2, $3, $4, $5)`,
      [teamId, challenge_id, JSON.stringify(submission_payload), isCorrect, pointsAwarded]
    );

    if (isCorrect) {
      await pool.query(
        `INSERT INTO team_scores (team_id, contest_id, total_score, last_submission_time)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (team_id) DO UPDATE 
         SET total_score = team_scores.total_score + $3,
             last_submission_time = NOW()`,
        [teamId, challenge.contest_id, pointsAwarded]
      );
    }

    return res.json({
      correct: isCorrect,
      points: pointsAwarded,
      feedback: feedback
    });
  } catch (err) {
    console.error('Submission error:', err);
    return res.status(500).json({ error: err.message });
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

export async function getActiveContests(req, res) {
  try {
    const result = await pool.query(
      `SELECT id, title, description, duration_minutes, is_active, created_at
       FROM contests
       WHERE is_active = TRUE
       ORDER BY id ASC`
    );
    res.json({ contests: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getSingleChallenge(req, res) {
  const teamId = req.user.id;
  const { id } = req.params;

  try {
    // 1. Get the team's current contest
    const teamRes = await pool.query('SELECT contest_id FROM teams WHERE id = $1', [teamId]);
    const contestId = teamRes.rows[0]?.contest_id;

    if (!contestId) {
      return res.status(400).json({ error: 'Please join a contest first' });
    }

    // 2. Fetch the specific challenge ensuring it belongs to this contest
    const result = await pool.query(
      `SELECT id, contest_id, challenge_number, title, description, challenge_type, 
              max_points, penalty_per_resubmit, supported_languages, content_payload 
       FROM challenges 
       WHERE id = $1 AND contest_id = $2`,
      [id, contestId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Challenge not found' });
    }

    // Return the challenge object
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}