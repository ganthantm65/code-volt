import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { pool } from '../config/db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'super_secure_code_shock_jwt_key_2026';

export async function adminLogin(req, res) {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM admins WHERE username = $1', [username]);
    const admin = result.rows[0];

    if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
      return res.status(401).json({ error: 'Invalid admin credentials' });
    }

    const token = jwt.sign(
      { id: admin.id, username: admin.username, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, message: 'Admin authenticated successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createContest(req, res) {
  const { title, description, access_code, duration_minutes } = req.body;
  const adminId = req.user.id;

  if (!title || !access_code) {
    return res.status(400).json({ error: 'Contest title and access_code are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO contests (title, description, access_code, duration_minutes, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [title, description || '', access_code.toUpperCase(), duration_minutes || 15, adminId]
    );

    res.status(201).json({ message: 'Contest created successfully', contest: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.detail || 'Access code already in use' });
  }
}

export async function addChallenge(req, res) {
  const { contest_id } = req.params;
  const {
    challenge_number,
    title,
    description,
    challenge_type,
    max_points,
    penalty_per_resubmit,
    supported_languages,
    content_payload,
    solution_payload
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO challenges (
        contest_id, challenge_number, title, description, challenge_type,
        max_points, penalty_per_resubmit, supported_languages, content_payload, solution_payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, contest_id, challenge_number, title, challenge_type, max_points`,
      [
        contest_id,
        challenge_number,
        title,
        description,
        challenge_type,
        max_points || 100,
        penalty_per_resubmit || 5,
        supported_languages || ['python', 'cpp', 'java'],
        content_payload,
        solution_payload
      ]
    );

    res.status(201).json({ message: 'Challenge created successfully', challenge: result.rows[0] });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function startContestGlobal(req, res) {
  const { contest_id } = req.params;
  try {
    const result = await pool.query(
      'UPDATE contests SET is_active = TRUE WHERE id = $1 RETURNING *',
      [contest_id]
    );

    if (result.rowCount === 0) return res.status(404).json({ error: 'Contest not found' });

    res.json({ message: 'Contest is now LIVE! Teams can join with the access code.', contest: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getAdminTeams(req, res) {
  try {
    const result = await pool.query(
      `SELECT 
         id, 
         team_name, 
         college, 
         start_time, 
         end_time, 
         is_finished, 
         is_disqualified 
       FROM teams 
       ORDER BY id ASC`
    );
    res.json({ teams: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function resetTeamTimer(req, res) {
  const { team_id } = req.params;
  try {
    // Extends or resets the timer to NOW() + 15 minutes
    const result = await pool.query(
      `UPDATE teams 
       SET start_time = NOW(),
           end_time = NOW() + INTERVAL '15 minutes',
           is_disqualified = false,
           is_finished = false
       WHERE id = $1
       RETURNING id, team_name, start_time, end_time`,
      [team_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: `Team with ID ${team_id} not found.` });
    }

    res.json({ 
      message: `Timer reset for team ID ${team_id}`, 
      team: result.rows[0] 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getAdminContests(req, res) {
  try {
    const result = await pool.query(
      `SELECT 
         c.id, 
         c.title, 
         c.description, 
         c.access_code, 
         c.duration_minutes, 
         c.is_active, 
         c.created_at,
         COUNT(ch.id) AS challenge_count
       FROM contests c
       LEFT JOIN challenges ch ON ch.contest_id = c.id
       GROUP BY c.id
       ORDER BY c.id ASC`
    );
    res.json({ contests: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}