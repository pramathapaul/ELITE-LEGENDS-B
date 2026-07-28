import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import playerRoutes from './routes/players.js';
import roomRoutes from './routes/rooms.js';
import uploadRoutes from './routes/upload.js';
import { setupAuctionSocket } from './socket/auctionHandler.js';
import Player from './models/Player.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'https://elitelegends.netlify.app/',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(cors({
  origin: process.env.CLIENT_URL || 'https://elitelegends.netlify.app/',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/players', express.static(path.join(__dirname, 'player-images')));
app.use('/api/auth', authRoutes);
app.use('/api/players', playerRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

setupAuctionSocket(io);

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  try {
    const result = await Player.updateMany(
      { imageStatus: { $exists: false } },
      { $set: { imageStatus: 'pending' } }
    );
    if (result.modifiedCount > 0) {
      console.log(`Migrated ${result.modifiedCount} legacy players with imageStatus: 'pending'`);
    }
  } catch (err) {
    console.error('Migration error:', err.message);
  }

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Socket.IO ready for real-time connections`);
  });
});

export { app, server, io };
