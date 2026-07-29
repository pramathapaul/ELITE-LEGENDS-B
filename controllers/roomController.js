import Room from '../models/Room.js';
import Team from '../models/Team.js';
import Player from '../models/Player.js';
import Manager from '../models/Manager.js';
import { v4 as uuidv4 } from 'uuid';

const generateRoomCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const POSITION_ORDER = ['Forward', 'Midfielder', 'Defender', 'Goalkeeper'];

export function reorderStartersByPosition(players, formation) {
  const posCounts = getPositionCounts(formation);
  const subs = players.filter(p => p.status === 'substitute');

  const grouped = { Forward: [], Midfielder: [], Defender: [], Goalkeeper: [] };
  for (const entry of players) {
    const pos = entry.player?.position || 'Midfielder';
    if (grouped[pos]) grouped[pos].push(entry);
  }

  for (const pos of Object.keys(grouped)) {
    grouped[pos].sort((a, b) => (b.player?.overall || 0) - (a.player?.overall || 0));
  }

  const pinned = [];
  const remaining = [];

  for (const pos of POSITION_ORDER) {
    const needed = posCounts[pos] || 0;
    const entries = grouped[pos] || [];
    pinned.push(...entries.slice(0, needed));
    remaining.push(...entries.slice(needed));
  }

  remaining.sort((a, b) => (b.player?.overall || 0) - (a.player?.overall || 0));

  const ordered = [...pinned];
  let slot = 11 - ordered.length;
  if (slot > 0) {
    ordered.push(...remaining.splice(0, slot));
  }

  for (const entry of remaining) {
    entry.status = 'substitute';
  }

  const orderedIds = new Set(ordered.map(e => e._id.toString()));
  for (const entry of subs) {
    if (!orderedIds.has(entry._id.toString())) {
      ordered.push(entry);
    }
  }

  return ordered;
}

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
          squadConfirmed: team?.squadConfirmed || false,
          manager: team?.manager || null,
          formation: team?.formation || '4-3-3',
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
    let team = await Team.findOne({ user: req.user._id, room: req.params.id })
      .populate('players.player')
      .populate('manager');

    if (!team) {
      return res.json({ players: [], totalSpent: 0, totalRating: 0, formation: '4-3-3', manager: null });
    }

    const room = await Room.findById(req.params.id);
    const budget = room?.participants?.find(
      (p) => p.user.toString() === req.user._id.toString()
    )?.budget || 0;

    const f = team.formation || '4-3-3';
    const reordered = reorderStartersByPosition(team.players, f);
    if (reordered.length > 0) {
      team.players = reordered;
      await team.save();
      team = await Team.findById(team._id).populate('players.player').populate('manager');
    }

    const starters = team.players.filter(p => p.status === 'starter');
    const formation = team.formation || deriveFormation(starters);

    const squadValue = team.players.reduce((sum, p) => sum + (p.winningBid || 0), 0);
    const avgRating = team.players.length > 0
      ? Math.round(team.players.reduce((sum, p) => sum + (p.player?.overall || 0), 0) / team.players.length)
      : 0;

    res.json({
      ...team.toObject(),
      formation,
      remainingBudget: budget,
      squadValue,
      avgRating,
    });
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
    const subs = team.players.filter(p => p.status === 'substitute');

    if (entry.status === 'starter') {
      entry.status = 'substitute';
    } else {
      if (starters.length >= 11) {
        return res.status(400).json({ message: 'Starting XI is full (max 11). Move a player to bench first.' });
      }
      entry.status = 'starter';
    }

    await team.save();

    const populated = await Team.findById(team._id).populate('players.player');
    const newStarters = populated.players.filter(p => p.status === 'starter');
    const formation = team.formation || '4-3-3';

    const reordered = reorderStartersByPosition(populated.players, formation);
    if (reordered.length > 0) {
      populated.players = reordered;
      await populated.save();
    }

    const repopulated = await Team.findById(team._id).populate('players.player');
    res.json({ ...repopulated.toObject(), formation });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getUserTeams = async (req, res) => {
  try {
    const teams = await Team.find({ user: req.user._id })
      .populate('players.player')
      .populate('room', 'name code')
      .populate('manager')
      .sort({ createdAt: -1 });

    const enriched = await Promise.all(teams.map(async (team) => {
      const room = team.room ? await Room.findById(team.room._id) : null;
      const budget = room?.participants?.find(
        (p) => p.user.toString() === req.user._id.toString()
      )?.budget || 0;
      const squadValue = team.players.reduce((sum, p) => sum + (p.winningBid || 0), 0);
      const avgRating = team.players.length > 0
        ? Math.round(team.players.reduce((sum, p) => sum + (p.player?.overall || 0), 0) / team.players.length)
        : 0;
      return {
        ...team.toObject(),
        remainingBudget: budget,
        squadValue,
        avgRating,
      };
    }));

    res.json(enriched);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const setManager = async (req, res) => {
  try {
    const { managerId } = req.body;
    const team = await Team.findOne({ user: req.user._id, room: req.params.id });
    if (!team) return res.status(404).json({ message: 'Team not found' });

    const manager = await Manager.findById(managerId);
    if (!manager) return res.status(404).json({ message: 'Manager not found' });

    team.manager = managerId;
    if (!team.formation || team.formation === '4-3-3') {
      team.formation = manager.preferredFormation;
    }
    await team.save();

    const populated = await Team.findById(team._id).populate('players.player').populate('manager');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const setFormation = async (req, res) => {
  try {
    const { formation } = req.body;
    const validFormations = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '3-4-3', '5-3-2', '5-4-1', '4-1-4-1', '4-3-2-1', '4-2-2-2'];
    if (!validFormations.includes(formation)) {
      return res.status(400).json({ message: 'Invalid formation' });
    }

    const team = await Team.findOne({ user: req.user._id, room: req.params.id });
    if (!team) return res.status(404).json({ message: 'Team not found' });

    team.formation = formation;
    await team.save();

    const populated = await Team.findById(team._id).populate('players.player').populate('manager');

    const reordered = reorderStartersByPosition(populated.players, formation);
    if (reordered.length > 0) {
      populated.players = reordered;
      await populated.save();
    }

    const repopulated = await Team.findById(team._id).populate('players.player').populate('manager');
    res.json(repopulated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const confirmSquad = async (req, res) => {
  try {
    const team = await Team.findOne({ user: req.user._id, room: req.params.id });
    if (!team) return res.status(404).json({ message: 'Team not found' });

    const starters = team.players.filter(p => p.status === 'starter');
    if (starters.length < 11) {
      return res.status(400).json({ message: `Need exactly 11 starters. Currently have ${starters.length}.` });
    }
    if (!team.manager) {
      return res.status(400).json({ message: 'Please appoint a manager before confirming your squad.' });
    }

    team.squadConfirmed = true;
    await team.save();

    const room = await Room.findById(req.params.id);
    if (room) {
      room.squadConfirmedCount = (room.squadConfirmedCount || 0) + 1;
      const totalNonSpectators = room.participants.filter(p => !p.isSpectator).length;
      if (room.squadConfirmedCount >= totalNonSpectators) {
        room.allSquadsConfirmed = true;
        room.phase = 'complete';
      }
      await room.save();
    }

    const populated = await Team.findById(team._id).populate('players.player').populate('manager');
    res.json({ ...populated.toObject(), room });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getManagers = async (req, res) => {
  try {
    const managers = await Manager.find().sort({ rating: -1 });
    res.json(managers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getBestXI = async (req, res) => {
  try {
    const team = await Team.findOne({ user: req.user._id, room: req.params.id })
      .populate('players.player')
      .populate('manager');

    if (!team || team.players.length === 0) {
      return res.json({ starters: [], bench: [], formation: '4-3-3' });
    }

    const formation = team.formation || '4-3-3';
    const posCounts = getPositionCounts(formation);
    const available = [...team.players];

    const recommendedStarters = [];
    const positionOrder = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];

    for (const pos of positionOrder) {
      const count = posCounts[pos] || 0;
      const candidates = available
        .filter(e => e.player?.position === pos)
        .sort((a, b) => (b.player?.overall || 0) - (a.player?.overall || 0));

      const selected = candidates.slice(0, count);
      recommendedStarters.push(...selected);

      selected.forEach(s => {
        const idx = available.findIndex(e => e.player?._id.toString() === s.player?._id.toString());
        if (idx !== -1) available.splice(idx, 1);
      });
    }

    const remainingSlots = 11 - recommendedStarters.length;
    if (remainingSlots > 0) {
      const fillers = available
        .sort((a, b) => (b.player?.overall || 0) - (a.player?.overall || 0))
        .slice(0, remainingSlots);
      recommendedStarters.push(...fillers);
    }

    const recommendedIds = new Set(recommendedStarters.map(s => s.player?._id?.toString()));
    const bench = available.filter(e => !recommendedIds.has(e.player?._id?.toString()));

    res.json({
      starters: recommendedStarters,
      bench,
      formation,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const applyBestXI = async (req, res) => {
  try {
    const team = await Team.findOne({ user: req.user._id, room: req.params.id })
      .populate('players.player');

    if (!team) return res.status(404).json({ message: 'Team not found' });

    const formation = team.formation || '4-3-3';
    const posCounts = getPositionCounts(formation);
    const available = [...team.players];

    team.players.forEach(p => { p.status = 'substitute'; });

    const positionOrder = ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'];
    const assigned = new Set();

    for (const pos of positionOrder) {
      const count = posCounts[pos] || 0;
      const candidates = available
        .filter(e => e.player?.position === pos && !assigned.has(e.player?._id?.toString()))
        .sort((a, b) => (b.player?.overall || 0) - (a.player?.overall || 0));

      const selected = candidates.slice(0, count);
      selected.forEach(s => {
        const entry = team.players.find(e => e.player?.toString() === s.player?._id?.toString());
        if (entry) entry.status = 'starter';
        assigned.add(s.player?._id?.toString());
      });
    }

    const remainingSlots = 11 - assigned.size;
    if (remainingSlots > 0) {
      const fillers = available
        .filter(e => !assigned.has(e.player?._id?.toString()))
        .sort((a, b) => (b.player?.overall || 0) - (a.player?.overall || 0))
        .slice(0, remainingSlots);
      fillers.forEach(s => {
        const entry = team.players.find(e => e.player?.toString() === s.player?._id?.toString());
        if (entry) entry.status = 'starter';
      });
    }

    await team.save();

    const populated = await Team.findById(team._id).populate('players.player').populate('manager');

    const reordered = reorderStartersByPosition(populated.players, formation);
    if (reordered.length > 0) {
      populated.players = reordered;
      await populated.save();
    }

    const repopulated = await Team.findById(team._id).populate('players.player').populate('manager');
    res.json(repopulated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

function getPositionCounts(formation) {
  const map = {
    '4-3-3': { Goalkeeper: 1, Defender: 4, Midfielder: 3, Forward: 3 },
    '4-2-3-1': { Goalkeeper: 1, Defender: 4, Midfielder: 5, Forward: 1 },
    '4-4-2': { Goalkeeper: 1, Defender: 4, Midfielder: 4, Forward: 2 },
    '3-5-2': { Goalkeeper: 1, Defender: 3, Midfielder: 5, Forward: 2 },
    '3-4-3': { Goalkeeper: 1, Defender: 3, Midfielder: 4, Forward: 3 },
    '5-3-2': { Goalkeeper: 1, Defender: 5, Midfielder: 3, Forward: 2 },
    '5-4-1': { Goalkeeper: 1, Defender: 5, Midfielder: 4, Forward: 1 },
    '4-1-4-1': { Goalkeeper: 1, Defender: 4, Midfielder: 5, Forward: 1 },
    '4-3-2-1': { Goalkeeper: 1, Defender: 4, Midfielder: 5, Forward: 1 },
    '4-2-2-2': { Goalkeeper: 1, Defender: 4, Midfielder: 4, Forward: 2 },
  };
  return map[formation] || { Goalkeeper: 1, Defender: 4, Midfielder: 3, Forward: 3 };
}

export const getAuctionSummary = async (req, res) => {
  try {
    const room = await Room.findById(req.params.id)
      .populate('participants.user', 'username email avatar')
      .populate('soldPlayers.player')
      .populate('soldPlayers.winner', 'username')
      .populate('unsoldPlayers.player');

    if (!room) return res.status(404).json({ message: 'Room not found' });

    const teams = await Team.find({ room: req.params.id })
      .populate('players.player')
      .populate('manager');

    const summary = {
      room: {
        name: room.name,
        code: room.code,
        status: room.status,
        phase: room.phase,
      },
      totalPlayersSold: room.soldPlayers.length,
      totalUnsold: room.unsoldPlayers.length,
      totalRevenue: room.soldPlayers.reduce((sum, s) => sum + (s.winningBid || 0), 0),
      teams: teams.map(team => {
        const participant = room.participants.find(
          p => p.user._id.toString() === team.user.toString()
        );
        const starters = team.players.filter(p => p.status === 'starter');
        const subs = team.players.filter(p => p.status === 'substitute');
        return {
          user: participant?.user || { username: 'Unknown' },
          budget: participant?.budget || 0,
          totalSpent: team.totalSpent,
          totalRating: team.totalRating,
          avgRating: team.players.length > 0
            ? Math.round(team.players.reduce((sum, p) => sum + (p.player?.overall || 0), 0) / team.players.length)
            : 0,
          squadValue: team.players.reduce((sum, p) => sum + (p.winningBid || 0), 0),
          starters: starters.length,
          substitutes: subs.length,
          totalPlayers: team.players.length,
          manager: team.manager,
          formation: team.formation,
          squadConfirmed: team.squadConfirmed,
        };
      }).sort((a, b) => {
        if (b.totalRating !== a.totalRating) return b.totalRating - a.totalRating;
        return b.squadValue - a.squadValue;
      }),
      soldPlayers: room.soldPlayers.map(s => ({
        player: s.player,
        winner: s.winner,
        winningBid: s.winningBid,
      })),
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const resetTeam = async (req, res) => {
  try {
    const team = await Team.findOne({ user: req.user._id, room: req.params.id });
    if (!team) return res.status(404).json({ message: 'Team not found' });

    team.players.forEach(p => { p.status = 'substitute'; });
    team.manager = null;
    team.formation = '4-3-3';
    team.squadConfirmed = false;
    await team.save();

    const populated = await Team.findById(team._id).populate('players.player').populate('manager');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const reorderPlayers = async (req, res) => {
  try {
    const { statusType, playerIds } = req.body;
    if (!['starter', 'substitute'].includes(statusType) || !Array.isArray(playerIds)) {
      return res.status(400).json({ message: 'Invalid request. Requires statusType and playerIds array.' });
    }

    const team = await Team.findOne({ user: req.user._id, room: req.params.id });
    if (!team) return res.status(404).json({ message: 'Team not found' });

    const targetEntries = team.players.filter(e => e.status === statusType);
    if (targetEntries.length !== playerIds.length) {
      return res.status(400).json({ message: `Expected ${targetEntries.length} player IDs, got ${playerIds.length}` });
    }

    const idMap = new Map();
    for (const entry of team.players) {
      idMap.set(entry.player.toString(), entry);
    }

    const ordered = [];
    const used = new Set();
    for (const pid of playerIds) {
      const entry = idMap.get(pid.toString());
      if (!entry || used.has(pid.toString())) {
        return res.status(400).json({ message: `Invalid player ID: ${pid}` });
      }
      ordered.push(entry);
      used.add(pid.toString());
    }

    const other = team.players.filter(e => e.status !== statusType);
    team.players = statusType === 'starter'
      ? [...ordered, ...other]
      : [...other, ...ordered];

    await team.save();

    const populated = await Team.findById(team._id).populate('players.player').populate('manager');
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
