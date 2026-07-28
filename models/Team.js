import mongoose from 'mongoose';

const teamSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: true,
  },
  players: [{
    player: { type: mongoose.Schema.Types.ObjectId, ref: 'Player' },
    winningBid: { type: Number },
    status: { type: String, enum: ['starter', 'substitute'], default: 'substitute' },
    boughtAt: { type: Date, default: Date.now },
  }],
  totalSpent: {
    type: Number,
    default: 0,
  },
  totalRating: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

teamSchema.index({ user: 1, room: 1 }, { unique: true });

export default mongoose.model('Team', teamSchema);
