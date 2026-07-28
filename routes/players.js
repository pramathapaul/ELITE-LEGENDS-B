import express from 'express';
import {
  getPlayers,
  getAllPlayers,
  getPlayerById,
  createPlayer,
  updatePlayer,
  deletePlayer,
  uploadPlayersBulk,
  exportPlayers,
  getCountries,
  getStats,
  getPlayerImage,
  getImageStats,
  downloadMissingBatch,
  retryFailedImages,
} from '../controllers/playerController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.get('/', getPlayers);
router.get('/all', getAllPlayers);
router.get('/countries', getCountries);
router.get('/stats', getStats);
router.get('/export', protect, exportPlayers);
router.get('/:id/image', getPlayerImage);
router.get('/:id', getPlayerById);
router.post('/', protect, createPlayer);
router.put('/:id', protect, updatePlayer);
router.delete('/:id', protect, deletePlayer);
router.post('/bulk', protect, uploadPlayersBulk);
router.get('/admin/image-stats', protect, getImageStats);
router.post('/admin/download-missing', protect, downloadMissingBatch);
router.post('/admin/retry-failed', protect, retryFailedImages);

export default router;
