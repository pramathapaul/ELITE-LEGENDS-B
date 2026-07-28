import Player from '../models/Player.js';
import { triggerPlayerImageDownload, ensurePlayerImage, downloadMissingImages } from '../services/imageService.js';

export const getPlayers = async (req, res) => {
  try {
    const { position, search, country, minRating, maxRating, rarity, page, limit, sort } = req.query;
    const filter = {};

    if (position) filter.position = position;
    if (country) filter.country = { $regex: country, $options: 'i' };
    if (search) filter.name = { $regex: search, $options: 'i' };
    if (rarity) filter.rarity = rarity;
    if (minRating || maxRating) {
      filter.overall = {};
      if (minRating) filter.overall.$gte = parseInt(minRating);
      if (maxRating) filter.overall.$lte = parseInt(maxRating);
    }

    let sortOption = { overall: -1 };
    if (sort === 'name') sortOption = { name: 1 };
    if (sort === 'price_asc') sortOption = { basePrice: 1 };
    if (sort === 'price_desc') sortOption = { basePrice: -1 };
    if (sort === 'rating_asc') sortOption = { overall: 1 };
    if (sort === 'rating_desc') sortOption = { overall: -1 };

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const skip = (pageNum - 1) * limitNum;

    const [players, total] = await Promise.all([
      Player.find(filter).sort(sortOption).skip(skip).limit(limitNum),
      Player.countDocuments(filter),
    ]);

    res.json({
      players,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getAllPlayers = async (req, res) => {
  try {
    const players = await Player.find({}).sort({ overall: -1 });
    res.json(players);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getPlayerById = async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ message: 'Player not found' });
    res.json(player);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const createPlayer = async (req, res) => {
  try {
    const player = await Player.create({ ...req.body, imageStatus: 'pending' });
    triggerPlayerImageDownload(player._id);
    res.status(201).json(player);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updatePlayer = async (req, res) => {
  try {
    const player = await Player.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!player) return res.status(404).json({ message: 'Player not found' });
    res.json(player);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deletePlayer = async (req, res) => {
  try {
    const player = await Player.findByIdAndDelete(req.params.id);
    if (!player) return res.status(404).json({ message: 'Player not found' });
    res.json({ message: 'Player deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const uploadPlayersBulk = async (req, res) => {
  try {
    const { players } = req.body;
    if (!Array.isArray(players) || players.length === 0) {
      return res.status(400).json({ message: 'Invalid player data' });
    }

    let inserted = 0;
    let skipped = 0;
    const errors = [];

    for (const playerData of players) {
      if (!playerData.name || !playerData.position || !playerData.country) {
        errors.push({ name: playerData.name || 'unknown', reason: 'Missing required fields' });
        continue;
      }
      const existing = await Player.findOne({ name: playerData.name });
      if (existing) {
        skipped++;
        continue;
      }
      try {
        await Player.create(playerData);
        inserted++;
      } catch (err) {
        errors.push({ name: playerData.name, reason: err.message });
      }
    }

    res.status(201).json({ inserted, skipped, errors });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const exportPlayers = async (req, res) => {
  try {
    const players = await Player.find({}).lean();
    res.json(players);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getCountries = async (req, res) => {
  try {
    const countries = await Player.distinct('country');
    res.json(countries.sort());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getStats = async (req, res) => {
  try {
    const total = await Player.countDocuments();
    const byPosition = await Player.aggregate([
      { $group: { _id: '$position', count: { $sum: 1 } } },
    ]);
    const avgRating = await Player.aggregate([
      { $group: { _id: null, avg: { $avg: '$overall' } } },
    ]);
    res.json({ total, byPosition, avgRating: avgRating[0]?.avg?.toFixed(1) || 0 });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getPlayerImage = async (req, res) => {
  try {
    const path = await ensurePlayerImage(req.params.id);
    if (!path) return res.status(404).json({ message: 'Image not available' });
    res.json({ image: path, imageStatus: 'ready' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getImageStats = async (req, res) => {
  try {
    const total = await Player.countDocuments();
    const ready = await Player.countDocuments({ imageStatus: 'ready' });
    const pending = await Player.countDocuments({ imageStatus: { $in: ['', 'pending'] } });
    const downloading = await Player.countDocuments({ imageStatus: 'downloading' });
    const failed = await Player.countDocuments({ imageStatus: 'failed' });
    res.json({ total, ready, pending, downloading, failed });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const downloadMissingBatch = async (req, res) => {
  try {
    res.json({ message: 'Download started', status: 'running' });
    downloadMissingImages().catch(() => {});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const retryFailedImages = async (req, res) => {
  try {
    const failed = await Player.find({ imageStatus: 'failed' });
    for (const player of failed) {
      triggerPlayerImageDownload(player._id);
    }
    res.json({ message: `Retrying ${failed.length} players`, count: failed.length });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
