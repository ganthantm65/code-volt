-- 1. Admins Table
CREATE TABLE IF NOT EXISTS admins (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Contests Table (Contains the Contest Access Code & State)
CREATE TABLE IF NOT EXISTS contests (
    id SERIAL PRIMARY KEY,
    title VARCHAR(150) NOT NULL,
    description TEXT,
    access_code VARCHAR(50) UNIQUE NOT NULL,
    duration_minutes INT DEFAULT 15,
    is_active BOOLEAN DEFAULT FALSE,
    is_completed BOOLEAN DEFAULT FALSE,
    created_by INT REFERENCES admins(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Teams Table
CREATE TABLE IF NOT EXISTS teams (
    id SERIAL PRIMARY KEY,
    contest_id INT REFERENCES contests(id) ON DELETE CASCADE,
    team_name VARCHAR(100) UNIQUE NOT NULL,
    member_one_name VARCHAR(100) NOT NULL,
    member_two_name VARCHAR(100) NOT NULL,
    college VARCHAR(200) NOT NULL,
    year INTEGER,
    joined_at TIMESTAMP WITH TIME ZONE NULL,
    start_time TIMESTAMP WITH TIME ZONE NULL,
    end_time TIMESTAMP WITH TIME ZONE NULL,
    is_finished BOOLEAN DEFAULT FALSE,
    is_disqualified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Challenges Table
CREATE TABLE IF NOT EXISTS challenges (
    id SERIAL PRIMARY KEY,
    contest_id INT REFERENCES contests(id) ON DELETE CASCADE,
    challenge_number INT NOT NULL,
    title VARCHAR(150) NOT NULL,
    description TEXT NOT NULL,
    challenge_type VARCHAR(30) NOT NULL, -- 'JUMBLED_CODE' or 'INVALID_TEST_CASE'
    max_points INT NOT NULL DEFAULT 100,
    penalty_per_resubmit INT DEFAULT 5,
    supported_languages TEXT[] DEFAULT ARRAY['python', 'cpp', 'java'],
    content_payload JSONB NOT NULL,
    solution_payload JSONB NOT NULL,
    UNIQUE(contest_id, challenge_number)
);

-- 5. Submissions Audit Log
CREATE TABLE IF NOT EXISTS submissions (
    id SERIAL PRIMARY KEY,
    contest_id INT REFERENCES contests(id) ON DELETE CASCADE,
    team_id INT REFERENCES teams(id) ON DELETE CASCADE,
    challenge_id INT REFERENCES challenges(id) ON DELETE CASCADE,
    submitted_payload JSONB NOT NULL,
    is_correct BOOLEAN NOT NULL DEFAULT FALSE,
    points_awarded INT NOT NULL DEFAULT 0,
    test_cases_passed INT DEFAULT 0,
    total_test_cases INT DEFAULT 0,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. Team Aggregated Scores Table
CREATE TABLE IF NOT EXISTS team_scores (
    team_id INT PRIMARY KEY REFERENCES teams(id) ON DELETE CASCADE,
    contest_id INT REFERENCES contests(id) ON DELETE CASCADE,
    total_score INT DEFAULT 0,
    solved_count INT DEFAULT 0,
    duration_seconds INT DEFAULT 0,
    last_submission_time TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_scores_rank 
ON team_scores (contest_id, total_score DESC, solved_count DESC, duration_seconds ASC, last_submission_time ASC);

-- Seed Default Admin: username 'admin', password 'adminpassword'
INSERT INTO admins (id, username, password_hash)
VALUES (1, 'admin', '$2b$10$WpZfA0.jV10vK7gZg75x3.1lK7kUkYF2sUaVbvP0lH14a34bX8b.i')
ON CONFLICT (username) DO NOTHING;