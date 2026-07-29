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
  setManager,
  setFormation,
  confirmSquad,
  getManagers,
  getBestXI,
  applyBestXI,
  getAuctionSummary,
  reorderPlayers,
  resetTeam,
} from '../controllers/roomController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/', protect, createRoom);
router.post('/join', protect, joinRoom);
router.get('/my-rooms', protect, getUserRooms);
router.get('/my/teams', protect, getUserTeams);
router.get('/managers', protect, getManagers);
router.get('/:id', protect, getRoom);
router.put('/:id/settings', protect, updateRoomSettings);
router.delete('/:id/kick/:userId', protect, kickUser);
router.put('/:id/transfer/:userId', protect, transferAdmin);
router.get('/:id/leaderboard', protect, getLeaderboard);
router.get('/:id/history', protect, getAuctionHistory);
router.get('/:id/my-team', protect, getMyTeam);
router.put('/:id/toggle-status/:playerId', protect, togglePlayerStatus);
router.put('/:id/manager', protect, setManager);
router.put('/:id/formation', protect, setFormation);
router.post('/:id/confirm-squad', protect, confirmSquad);
router.get('/:id/best-xi', protect, getBestXI);
router.post('/:id/apply-best-xi', protect, applyBestXI);
router.get('/:id/summary', protect, getAuctionSummary);
router.put('/:id/reorder-players', protect, reorderPlayers);
router.post('/:id/reset-team', protect, resetTeam);

export default router;
