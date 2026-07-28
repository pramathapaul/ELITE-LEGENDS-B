import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema({
  room: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  username: {
    type: String,
    default: 'System',
  },
  message: {
    type: String,
    required: true,
    maxlength: 500,
  },
  type: {
    type: String,
    enum: ['user', 'system', 'admin', 'notification'],
    default: 'user',
  },
}, {
  timestamps: true,
});

chatMessageSchema.index({ room: 1, createdAt: -1 });

export default mongoose.model('ChatMessage', chatMessageSchema);
