import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  nickname: {
    type: String,
    default: '',
  },
  country: {
    type: String,
    required: true,
  },
  position: {
    type: String,
    required: true,
    enum: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'],
  },
  preferredFoot: {
    type: String,
    enum: ['Left', 'Right', 'Both'],
    required: true,
  },
  overall: {
    type: Number,
    required: true,
    min: 60,
    max: 100,
  },
  basePrice: {
    type: Number,
    required: true,
    min: 1000000,
  },
  ageAtRetirement: {
    type: Number,
    min: 30,
    max: 50,
  },
  height: String,
  weight: String,
  peakClub: {
    type: String,
    required: true,
  },
  otherClubs: [String],
  careerYears: String,
  jerseyNumber: Number,
  captain: { type: Boolean, default: false },
  worldCupWinner: { type: Boolean, default: false },
  ballonDor: { type: Number, default: 0 },
  championsLeague: { type: Number, default: 0 },
  leagueTitles: { type: Number, default: 0 },
  internationalCaps: { type: Number, default: 0 },
  internationalGoals: { type: Number, default: 0 },
  description: { type: String, default: '' },
  image: { type: String, default: '' },
  imageStatus: {
    type: String,
    enum: ['', 'pending', 'downloading', 'ready', 'failed'],
    default: 'pending',
  },
  nationalFlag: { type: String, default: '' },
  positionColor: { type: String, default: '' },
  rarity: {
    type: String,
    enum: ['Legend', 'Icon', 'Hero', 'Common'],
    default: 'Legend',
  },
  isAuctioned: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

playerSchema.index({ position: 1, overall: -1 });
playerSchema.index({ country: 1 });
playerSchema.index({ name: 1 });
playerSchema.index({ rarity: 1 });
playerSchema.index({ overall: -1 });
playerSchema.index({ basePrice: 1 });

export default mongoose.model('Player', playerSchema);
