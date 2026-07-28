import Room from '../models/Room.js';
import Team from '../models/Team.js';
import ChatMessage from '../models/ChatMessage.js';
import Player from '../models/Player.js';

const auctionTimers = new Map();
const auctionState = new Map();
const processingSales = new Set();

export const setupAuctionSocket = (io) => {
  io.on('connection', (socket) => {
    let currentRoom = null;
    let currentUser = null;

    socket.on('join-room', async ({ roomId, user }) => {
      try {
        currentRoom = roomId;
        currentUser = user;
        socket.join(roomId);

        socket.to(roomId).emit('user-joined', {
          user,
          message: `${user.username} joined the room`,
        });

        await ChatMessage.create({
          room: roomId,
          username: 'System',
          message: `${user.username} joined the room`,
          type: 'notification',
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('leave-room', async ({ roomId, user }) => {
      try {
        socket.leave(roomId);
        socket.to(roomId).emit('user-left', {
          user,
          message: `${user.username} left the room`,
        });

        await ChatMessage.create({
          room: roomId,
          username: 'System',
          message: `${user.username} left the room`,
          type: 'notification',
        });

        if (currentRoom === roomId) currentRoom = null;
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('chat-message', async ({ roomId, message, user }) => {
      try {
        const chatMsg = await ChatMessage.create({
          room: roomId,
          user: user._id,
          username: user.username,
          message,
          type: 'user',
        });

        io.to(roomId).emit('new-chat-message', {
          _id: chatMsg._id,
          username: user.username,
          message,
          type: 'user',
          createdAt: chatMsg.createdAt,
        });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('start-auction', async ({ roomId }) => {
      try {
        const room = await Room.findById(roomId).populate('assignedPlayers');
        if (!room) return socket.emit('error', { message: 'Room not found' });

        if (room.assignedPlayers.length === 0) {
          return socket.emit('error', { message: 'No players assigned to room. Assign players first.' });
        }

        room.status = 'active';
        room.currentPlayerIndex = 0;
        room.soldPlayers = [];
        await room.save();

        const currentPlayer = room.assignedPlayers[0];

        io.to(roomId).emit('auction-started', { room });
        startPlayerAuction(io, roomId, currentPlayer, room.settings);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('place-bid', async ({ roomId, playerId, bidAmount, user }) => {
      try {
        const room = await Room.findById(roomId);
        if (!room || room.status !== 'active') {
          return socket.emit('error', { message: 'Auction not active' });
        }

        const participant = room.participants.find(
          (p) => p.user.toString() === user._id
        );
        if (!participant) {
          return socket.emit('error', { message: 'Not a participant' });
        }

        const state = auctionState.get(roomId);
        if (!state) {
          return socket.emit('error', { message: 'Auction state not found. Please wait for next player.' });
        }

        if (bidAmount > participant.budget) {
          socket.emit('bid-rejected', {
            message: 'Insufficient budget',
            playerId,
          });
          return;
        }

        if (bidAmount <= state.currentBid) {
          socket.emit('bid-rejected', {
            message: 'Bid must be higher than current bid',
            playerId,
          });
          return;
        }

        state.currentBid = bidAmount;
        state.highestBidder = user._id;
        state.highestBidderUsername = user.username;
        state.highestBidderAvatar = user.avatar || '';

        io.to(roomId).emit('new-bid', {
          playerId,
          bidAmount,
          user: { _id: user._id, username: user.username, avatar: user.avatar },
          timestamp: new Date(),
        });

        resetTimer(io, roomId, room.settings.auctionTimer);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('pause-auction', async ({ roomId }) => {
      try {
        const room = await Room.findById(roomId);
        if (!room) return;
        room.status = 'paused';
        await room.save();
        clearTimer(roomId);
        io.to(roomId).emit('auction-paused', { room });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('resume-auction', async ({ roomId }) => {
      try {
        const room = await Room.findById(roomId).populate('assignedPlayers');
        if (!room) return;
        room.status = 'active';
        await room.save();

        const currentPlayer = room.assignedPlayers[room.currentPlayerIndex];
        io.to(roomId).emit('auction-resumed', { room });
        if (currentPlayer) {
          startPlayerAuction(io, roomId, currentPlayer, room.settings);
        }
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('end-auction', async ({ roomId }) => {
      try {
        clearTimer(roomId);
        auctionState.delete(roomId);
        const room = await Room.findById(roomId);
        if (room) {
          room.status = 'ended';
          await room.save();
        }
        io.to(roomId).emit('auction-ended', { room });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('force-sell', async ({ roomId, user: caller }) => {
      try {
        if (processingSales.has(roomId)) {
          return socket.emit('error', { message: 'Sale already in progress for this room.' });
        }

        const state = auctionState.get(roomId);
        if (!state || !state.highestBidder) {
          return socket.emit('error', { message: 'No bids placed yet. Cannot sell.' });
        }

        if (state.highestBidder === caller._id) {
          return socket.emit('error', { message: 'Highest bidder cannot force sell.' });
        }

        clearTimer(roomId);
        await finalizePlayerSale(io, roomId);
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('assign-players', async ({ roomId }) => {
      try {
        const room = await Room.findById(roomId);
        if (!room) return socket.emit('error', { message: 'Room not found' });
        if (room.admin.toString() !== socket.handshake.query.userId) {
          return socket.emit('error', { message: 'Only admin can assign players' });
        }

        const squadSize = room.settings.squadSize;
        const totalPlayers = await Player.countDocuments();
        if (totalPlayers === 0) {
          return socket.emit('error', { message: 'No players in database. Seed players first.' });
        }

        const count = Math.min(squadSize, totalPlayers);
        const randomPlayers = await Player.aggregate([
          { $sample: { size: count } },
        ]);

        room.assignedPlayers = randomPlayers.map(p => p._id);
        room.currentPlayerIndex = 0;
        room.soldPlayers = [];
        await room.save();

        const populated = await Room.findById(roomId).populate('assignedPlayers');
        io.to(roomId).emit('players-assigned', { room: populated });
      } catch (error) {
        socket.emit('error', { message: error.message });
      }
    });

    socket.on('disconnect', async () => {
      if (currentRoom && currentUser) {
        socket.to(currentRoom).emit('user-left', {
          user: currentUser,
          message: `${currentUser.username} disconnected`,
        });
      }
    });
  });
};

const startPlayerAuction = (io, roomId, player, settings) => {
  clearTimer(roomId);

  const state = {
    currentBid: 0,
    highestBidder: null,
    highestBidderUsername: '',
    highestBidderAvatar: '',
    playerId: player._id,
  };
  auctionState.set(roomId, state);

  io.to(roomId).emit('new-player-auction', {
    player,
    currentBid: 0,
    highestBidder: null,
    timer: settings.auctionTimer,
    basePrice: player.basePrice,
    bidIncrement: settings.bidIncrement,
    bidIncrementType: settings.bidIncrementType,
  });

  let timeLeft = settings.auctionTimer;

  const timer = setInterval(async () => {
    timeLeft--;
    io.to(roomId).emit('timer-tick', { timeLeft });

    if (timeLeft <= 0) {
      clearInterval(timer);
      auctionTimers.delete(roomId);
      await finalizePlayerSale(io, roomId);
    }
  }, 1000);

  auctionTimers.set(roomId, timer);
};

const resetTimer = (io, roomId, duration) => {
  clearTimer(roomId);
  io.to(roomId).emit('timer-reset', { duration });

  let timeLeft = duration;

  const timer = setInterval(async () => {
    timeLeft--;
    io.to(roomId).emit('timer-tick', { timeLeft });

    if (timeLeft <= 0) {
      clearInterval(timer);
      auctionTimers.delete(roomId);
      await finalizePlayerSale(io, roomId);
    }
  }, 1000);

  auctionTimers.set(roomId, timer);
};

const clearTimer = (roomId) => {
  const existing = auctionTimers.get(roomId);
  if (existing) {
    clearInterval(existing);
    auctionTimers.delete(roomId);
  }
};

const finalizePlayerSale = async (io, roomId) => {
  if (processingSales.has(roomId)) return;
  processingSales.add(roomId);
  try {
    const room = await Room.findById(roomId)
      .populate('assignedPlayers')
      .populate('participants.user', 'username email avatar');

    if (!room || room.status !== 'active') return;

    const currentPlayer = room.assignedPlayers[room.currentPlayerIndex];
    if (!currentPlayer) return;

    const state = auctionState.get(roomId);
    const highestBid = state?.currentBid || 0;
    const highestBidderId = state?.highestBidder;

    io.to(roomId).emit('auction-closing', {
      playerId: currentPlayer._id,
      playerName: currentPlayer.name,
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (highestBid > 0 && highestBidderId) {
      const participant = room.participants.find(
        (p) => p.user._id.toString() === highestBidderId.toString()
      );
      if (participant) {
        participant.budget -= highestBid;

        let team = await Team.findOne({ user: highestBidderId, room: roomId });
        if (!team) {
          team = await Team.create({
            user: highestBidderId,
            room: roomId,
            players: [],
            totalSpent: 0,
            totalRating: 0,
          });
        }

        const starterCount = team.players.filter(p => p.status === 'starter').length;
        team.players.push({
          player: currentPlayer._id,
          winningBid: highestBid,
          status: starterCount < 11 ? 'starter' : 'substitute',
        });
        team.totalSpent += highestBid;
        team.totalRating += currentPlayer.overall;
        await team.save();

        const populatedTeam = await Team.findById(team._id).populate('players.player');
        io.to(roomId).emit('team-updated', {
          userId: highestBidderId.toString(),
          team: populatedTeam,
        });

        room.soldPlayers.push({
          player: currentPlayer._id,
          winner: highestBidderId,
          winningBid: highestBid,
        });
      }
    }

    room.currentPlayerIndex += 1;
    await room.save();

    const updatedRoom = await Room.findById(roomId)
      .populate('assignedPlayers')
      .populate('participants.user', 'username email avatar')
      .populate('soldPlayers.player')
      .populate('soldPlayers.winner', 'username');

    auctionState.delete(roomId);

    if (highestBid > 0 && highestBidderId) {
      io.to(roomId).emit('player-sold', {
        player: currentPlayer,
        winner: highestBidderId,
        winningBid: highestBid,
        room: updatedRoom,
      });

      await ChatMessage.create({
        room: roomId,
        username: 'System',
        message: `${currentPlayer.name} sold to ${state?.highestBidderUsername || 'Unknown'} for $${(highestBid / 1000000).toFixed(1)}M`,
        type: 'notification',
      });
    } else {
      io.to(roomId).emit('player-unsold', {
        player: currentPlayer,
        room: updatedRoom,
      });
    }

    if (room.currentPlayerIndex >= room.assignedPlayers.length) {
      room.status = 'ended';
      await room.save();
      io.to(roomId).emit('auction-ended', { room: updatedRoom });
      return;
    }

    const nextPlayer = room.assignedPlayers[room.currentPlayerIndex];
    setTimeout(() => {
      startPlayerAuction(io, roomId, nextPlayer, room.settings);
    }, 3000);
  } catch (error) {
    console.error('Finalize sale error:', error);
  } finally {
    processingSales.delete(roomId);
  }
};
