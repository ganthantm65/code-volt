import express from 'express';
import cors from 'cors';
import { 
  adminLogin, 
  createContest, 
  addChallenge, 
  startContestGlobal,
  getAdminTeams,       // <-- Added
  resetTeamTimer       // <-- Added
} from './controllers/adminController.js';
import {
  registerTeam,
  loginTeamWithAccessCode,
  joinContest,
  getContestChallenges,
  submitChallenge,
  completeContest
} from './controllers/teamContestController.js';
import { getContestLeaderboard } from './controllers/leaderBoardController.js';
import { verifyAdmin, verifyTeam } from './middleware/authMiddleware.js';
import { getActiveContests } from './controllers/teamContestController.js';

import { 
  getAdminContests, 
} from './controllers/adminController.js';

const app = express();
app.use(cors());
app.use(express.json());

// Admin Routes
app.post('/api/admin/login', adminLogin);
app.post('/api/admin/contests', verifyAdmin, createContest);
app.post('/api/admin/contests/:contest_id/challenges', verifyAdmin, addChallenge);
app.patch('/api/admin/contests/:contest_id/start', verifyAdmin, startContestGlobal);
app.get('/api/admin/teams', verifyAdmin, getAdminTeams);                       // <-- Added
app.get('/api/admin/contests/:contest_id/teams', verifyAdmin, getAdminTeams);   // <-- Added
app.post('/api/admin/teams/:team_id/reset-timer', verifyAdmin, resetTeamTimer); // <-- Added
app.get('/api/admin/leaderboard', getContestLeaderboard);                      // <-- Added alias for frontend

// Team Routes
app.post('/api/team/register', registerTeam);
app.post('/api/team/login', loginTeamWithAccessCode);
app.post('/api/team/join', verifyTeam, joinContest);
app.get('/api/team/challenges', verifyTeam, getContestChallenges);
app.post('/api/team/submit', verifyTeam, submitChallenge);
app.post('/api/team/complete', verifyTeam, completeContest);
app.get('/api/team/contests', verifyTeam, getActiveContests);

// Public Leaderboard
app.get('/api/contests/:contest_id/leaderboard', getContestLeaderboard);


// Admin contest routes
app.get('/api/admin/contests', verifyAdmin, getAdminContests);
app.post('/api/admin/contests', verifyAdmin, createContest);
app.patch('/api/admin/contests/:contest_id/start', verifyAdmin, startContestGlobal);

export default app;