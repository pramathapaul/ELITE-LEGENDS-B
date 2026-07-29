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
import Manager, { managersData } from './models/Manager.js';
import { downloadMissingImages } from './services/imageService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'http://localhost:5173',
  'https://elitelegends.netlify.app',
  process.env.CLIENT_URL,
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.netlify.app')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.netlify.app')) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/players', express.static(path.join(__dirname, 'player-images')));
app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/players', playerRoutes);
app.use('/api/players', playerRoutes);
app.use('/rooms', roomRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/upload', uploadRoutes);
app.use('/api/upload', uploadRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

setupAuctionSocket(io);

const PORT = process.env.PORT || 5000;

connectDB().then(async () => {
  try {
    const managerCount = await Manager.countDocuments();
    if (managerCount === 0) {
      await Manager.insertMany(managersData);
      console.log(`Seeded ${managersData.length} managers`);
    }
  } catch (err) {
    console.error('Manager seeding error:', err.message);
  }

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

    setTimeout(async () => {
      try {
        const pendingCount = await Player.countDocuments({ imageStatus: 'pending' });
        if (pendingCount > 0) {
          console.log(`Starting image download for ${pendingCount} players...`);
          downloadMissingImages().catch(err => console.error('Image download error:', err.message));
        }
      } catch (e) {}
    }, 2000);
  });
});

export { app, server, io };
