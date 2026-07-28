import Room from '../models/Room.js';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import { v4 as uuidv4 } from 'uuid';

const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

export const createRoom = async (req, res) => {
  try {
    const { name, settings } = req.body;

    let code;
    let isUnique = false;
    while (!isUnique) {
      code = generateRoomCode();
      const existing = await Room.findOne({ code });
      if (!existing) isUnique = true;
    }

    const room = await Room.create({
      name,
      code,
      admin: req.user._id,
      settings: {
        maxParticipants: settings?.maxParticipants || 10,
        squadSize: settings?.squadSize || 11,
        startingBudget: settings?.startingBudget || 500000000,
        auctionTimer: settings?.auctionTimer || 30,
        bidIncrement: settings?.bidIncrement || 2000000,
        bidIncrementType: settings?.bidIncrementType || 'fixed',
        auctionOrder: settings?.auctionOrder || 'random',
        spectatorMode: settings?.spectatorMode || false,
      },
      participants: [{
        user: req.user._id,
        budget: settings?.startingBudget || 500000000,
      }],
    });

    const populated = await Room.findById(room._id)
      .populate('participants.user', 'username email avatar')
      .populate('admin', 'username email avatar');

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const joinRoom = async (req, res) => {
  try {
    const { code } = req.body;
    const room = await Room.findOne({ code: code.toUpperCase() });

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    if (room.locked) {
      return res.status(403).json({ message: 'Room is locked' });
    }

    if (room.status !== 'waiting' && room.status !== 'starting') {
      return res.status(403).json({ message: 'Auction already in progress' });
    }

    const existingParticipant = room.participants.find(
      (p) => p.user.toString() === req.user._id.toString()
    );

    if (existingParticipant) {
      return res.json(await Room.findById(room._id)
        .populate('participants.user', 'username email avatar')
        .populate('admin', 'username email avatar')
        .populate('soldPlayers.player')
        .populate('soldPlayers.winner', 'username'));
    }

    if (room.participants.length >= room.settings.maxParticipants) {
      return res.status(403).json({ message: 'Room is full' });
    }

    room.participants.push({
      user: req.user._id,
      budget: room.settings.startingBudget,
    });

    await room.save();

    const populated = await Room.findById(room._id)
      .populate('participants.user', 'username email avatar')
      .populate('admin', 'username email avatar')
      .populate('soldPlayers.player')
      .populate('soldPlayers.winner', 'username');

    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getRoom = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id)
      .populate('participants.user', 'username email avatar')
      .populate('admin', 'username email avatar')
      .populate('soldPlayers.player')
      .populate('soldPlayers.winner', 'username')
      .populate('assignedPlayers');

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    res.json(room);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getUserRooms = async (req, res) => {
  try {
    const rooms = await Room.find({
      'participants.user': req.user._id,
    })
      .populate('admin', 'username email avatar')
      .populate('participants.user', 'username email avatar')
      .sort({ updatedAt: -1 })
      .limit(20);

    res.json(rooms);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const updateRoomSettings = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);

    if (!room) {
      return res.status(404).json({ message: 'Room not found' });
    }

    if (room.admin.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only admin can change settings' });
    }

    if (req.body.settings) {
      Object.assign(room.settings, req.body.settings);
    }

    if (req.body.name) room.name = req.body.name;
    if (req.body.locked !== undefined) room.locked = req.body.locked;

    await room.save();

    const populated = await Room.findById(room._id)
      .populate('participants.user', 'username email avatar')
      .populate('admin', 'username email avatar');

    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const kickUser = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.admin.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only admin can kick users' });
    }

    const userId = req.params.userId;
    room.participants = room.participants.filter(
      (p) => p.user.toString() !== userId
    );
    await room.save();

    const populated = await Room.findById(room._id)
      .populate('participants.user', 'username email avatar')
      .populate('admin', 'username email avatar');

    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const transferAdmin = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: 'Room not found' });
    if (room.admin.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only admin can transfer' });
    }

    room.admin = req.params.userId;
    await room.save();

    const populated = await Room.findById(room._id)
      .populate('participants.user', 'username email avatar')
      .populate('admin', 'username email avatar');

    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getLeaderboard = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id)
      .populate('participants.user', 'username email avatar');

    if (!room) return res.status(404).json({ message: 'Room not found' });

    const teams = await Team.find({ room: req.params.id })
      .populate('players.player');

    const leaderboard = room.participants
      .filter((p) => !p.isSpectator)
      .map((p) => {
        const team = teams.find((t) => t.user.toString() === p.user._id.toString());
        const teamPlayers = team?.players || [];
        return {
          user: p.user,
          budget: p.budget,
          totalSpent: team?.totalSpent || 0,
          totalPlayers: teamPlayers.length,
          totalRating: team?.totalRating || 0,
          starters: teamPlayers.filter(p => p.status === 'starter').length,
          substitutes: teamPlayers.filter(p => p.status === 'substitute').length,
        };
      })
      .sort((a, b) => {
        if (b.totalPlayers !== a.totalPlayers) return b.totalPlayers - a.totalPlayers;
        return b.totalRating - a.totalRating;
      });

    res.json(leaderboard);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getAuctionHistory = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id)
      .populate('soldPlayers.player')
      .populate('soldPlayers.winner', 'username');

    if (!room) return res.status(404).json({ message: 'Room not found' });

    res.json(room.soldPlayers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getMyTeam = async (req, res) => {
  try {
    const team = await Team.findOne({ user: req.user._id, room: req.params.id })
      .populate('players.player');

    if (!team) {
      return res.json({ players: [], totalSpent: 0, totalRating: 0, formation: '4-3-3' });
    }

    const starters = team.players.filter(p => p.status === 'starter');
    const formation = deriveFormation(starters);
    res.json({ ...team.toObject(), formation });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

function deriveFormation(starters) {
  const counts = { Goalkeeper: 0, Defender: 0, Midfielder: 0, Forward: 0 };
  starters.forEach(p => {
    if (counts[p.player?.position] !== undefined) counts[p.player.position]++;
  });
  if (counts.Goalkeeper < 1) return '4-3-3';
  return `${counts.Defender || 4}-${counts.Midfielder || 3}-${counts.Forward || 3}`;
}

export const togglePlayerStatus = async (req, res) => {
  try {
    const { playerId } = req.params;
    const team = await Team.findOne({ user: req.user._id, room: req.params.id });
    if (!team) return res.status(404).json({ message: 'Team not found' });

    const entry = team.players.find(p => p.player.toString() === playerId);
    if (!entry) return res.status(404).json({ message: 'Player not in your team' });

    const starters = team.players.filter(p => p.status === 'starter');

    if (entry.status === 'starter') {
      entry.status = 'substitute';
    } else {
      if (starters.length >= 11) {
        return res.status(400).json({ message: 'Starting XI is full. Remove a starter first.' });
      }
      entry.status = 'starter';
    }

    await team.save();

    const populated = await Team.findById(team._id).populate('players.player');
    const newStarters = populated.players.filter(p => p.status === 'starter');
    const formation = deriveFormation(newStarters);

    res.json({ ...populated.toObject(), formation });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getUserTeams = async (req, res) => {
  try {
    const teams = await Team.find({ user: req.user._id })
      .populate('players.player')
      .populate('room', 'name code')
      .sort({ createdAt: -1 });

    res.json(teams);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
