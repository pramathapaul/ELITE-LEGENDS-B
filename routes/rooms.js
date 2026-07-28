import express from 'express';
import {
  createRoom,
  joinRoom,
  getRoom,
  getUserRooms,
  updateRoomSettings,
  kickUser,
  transferAdmin,
  getLeaderboard,
  getAuctionHistory,
  getMyTeam,
  togglePlayerStatus,
  getUserTeams,
} from '../controllers/roomController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/', protect, createRoom);
router.post('/join', protect, joinRoom);
router.get('/my-rooms', protect, getUserRooms);
router.get('/:id', protect, getRoom);
router.put('/:id/settings', protect, updateRoomSettings);
router.delete('/:id/kick/:userId', protect, kickUser);
router.put('/:id/transfer/:userId', protect, transferAdmin);
router.get('/:id/leaderboard', protect, getLeaderboard);
router.get('/:id/history', protect, getAuctionHistory);
router.get('/my/teams', protect, getUserTeams);
router.get('/:id/my-team', protect, getMyTeam);
router.put('/:id/toggle-status/:playerId', protect, togglePlayerStatus);

export default router;
