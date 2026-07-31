import mongoose from 'mongoose';

const roomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  code: {
    type: String,
    required: true,
    unique: true,
    length: 6,
    uppercase: true,
  },
  admin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  status: {
    type: String,
    enum: ['waiting', 'starting', 'active', 'paused', 'ended'],
    default: 'waiting',
  },
  phase: {
    type: String,
    enum: ['auction', 'team_management', 'complete'],
    default: 'auction',
  },
  settings: {
    maxParticipants: { type: Number, default: 10, min: 2, max: 50 },
    squadSize: { type: Number, default: 30, min: 5, max: 80 },
    startingBudget: { type: Number, default: 500000000, min: 50000000 },
    auctionTimer: { type: Number, default: 30, min: 10, max: 120 },
    bidIncrement: { type: Number, default: 2000000, min: 500000 },
    bidIncrementType: { type: String, enum: ['fixed', 'percentage'], default: 'fixed' },
    auctionOrder: {
      type: String,
      enum: ['random', 'rating_desc', 'rating_asc', 'position'],
      default: 'random',
    },
    spectatorMode: { type: Boolean, default: false },
  },
  locked: {
    type: Boolean,
    default: false,
  },
  participants: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    budget: { type: Number },
    joinedAt: { type: Date, default: Date.now },
    isSpectator: { type: Boolean, default: false },
  }],
  currentPlayerIndex: {
    type: Number,
    default: 0,
  },
  assignedPlayers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Player',
  }],
  soldPlayers: [{
    player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    winningBid: { type: Number },
    soldAt: { type: Date, default: Date.now },
  }],
  unsoldPlayers: [{
    player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    skippedAt: { type: Date, default: Date.now },
  }],
  squadConfirmedCount: {
    type: Number,
    default: 0,
  },
  allSquadsConfirmed: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

roomSchema.index({ admin: 1 });

export default mongoose.model('Room', roomSchema);
