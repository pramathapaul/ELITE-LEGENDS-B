import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import Player from '../models/Player.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_DIR = path.join(__dirname, '..', 'player-images');
const WIKIMEDIA_API = 'https://commons.wikimedia.org/w/api.php';

const RETRY_DELAYS = [1000, 3000, 8000];
const BATCH_CONCURRENCY = 5;

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR, { recursive: true });

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function searchWikimedia(searchName) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${searchName} footballer`,
    gsrnamespace: '6',
    gsrlimit: '5',
    prop: 'imageinfo',
    iiprop: 'url',
    iiurlwidth: '800',
    format: 'json',
    origin: '*',
  });

  const response = await fetch(`${WIKIMEDIA_API}?${params}`, {
    headers: { 'User-Agent': 'FootballAuctionApp/1.0 (football@auction.app)' },
  });
  if (!response.ok) return null;

  const data = await response.json();
  const pages = data.query?.pages;
  if (!pages) return null;

  const entries = Object.values(pages);
  const firstNameLower = searchName.split(' ')[0]?.toLowerCase();

  let best = null;
  let bestScore = -1;

  for (const page of entries) {
    const info = page?.imageinfo?.[0];
    if (!info?.url) continue;
    const url = info.url.startsWith('//') ? 'https:' + info.url : info.url;
    const title = (page.title || '').replace('File:', '').toLowerCase();
    const desc = page.description?.toLowerCase() || '';

    let score = 0;
    if (title.includes(firstNameLower)) score += 3;
    if (title.includes('portrait')) score += 2;
    if (desc.includes('football') || desc.includes('soccer')) score += 1;
    if (title.includes(searchName.toLowerCase())) score += 5;

    const imgExt = path.extname(url).toLowerCase();
    if (['.jpg', '.jpeg', '.png'].includes(imgExt)) score += 1;
    if (info.width && info.width > 400) score += 1;

    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }

  return best || (entries[0]?.imageinfo?.[0]?.url
    ? (entries[0].imageinfo[0].url.startsWith('//') ? 'https:' + entries[0].imageinfo[0].url : entries[0].imageinfo[0].url)
    : null);
}

async function downloadAndConvert(imageUrl, outputPath) {
  const response = await fetch(imageUrl, {
    headers: { 'User-Agent': 'FootballAuctionApp/1.0 (football@auction.app)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await sharp(buffer).webp({ quality: 80, effort: 4 }).toFile(outputPath);
}

async function processPlayerImage(player) {
  const slug = slugify(player.name);
  const filename = `${slug}.webp`;
  const filePath = path.join(IMAGE_DIR, filename);

  if (fs.existsSync(filePath)) {
    const localPath = `/players/${filename}`;
    if (player.image !== localPath || player.imageStatus !== 'ready') {
      await Player.findByIdAndUpdate(player._id, { image: localPath, imageStatus: 'ready' });
    }
    return localPath;
  }

  await Player.findByIdAndUpdate(player._id, { imageStatus: 'downloading' });

  const searchName = player.name
    .replace(/['']/g, '')
    .replace(/[^a-zA-Z0-9 -]/g, '')
    .trim();

  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]));

      const imgUrl = await searchWikimedia(searchName);
      if (!imgUrl) throw new Error('No image found on Wikimedia');

      await downloadAndConvert(imgUrl, filePath);
      const localPath = `/players/${filename}`;
      await Player.findByIdAndUpdate(player._id, { image: localPath, imageStatus: 'ready' });
      return localPath;
    } catch (err) {
      lastError = err;
    }
  }

  await Player.findByIdAndUpdate(player._id, { imageStatus: 'failed' });
  throw lastError;
}

export async function ensurePlayerImage(playerId) {
  const player = await Player.findById(playerId);
  if (!player) return null;

  if (player.imageStatus === 'ready' && player.image && fs.existsSync(path.join(IMAGE_DIR, path.basename(player.image)))) {
    return player.image;
  }

  try {
    return await processPlayerImage(player);
  } catch {
    return null;
  }
}

export async function triggerPlayerImageDownload(playerId) {
  const player = await Player.findById(playerId);
  if (!player) return;

  if (player.imageStatus === 'downloading') return;
  if (player.imageStatus === 'ready' && player.image) {
    const filePath = path.join(IMAGE_DIR, path.basename(player.image));
    if (fs.existsSync(filePath)) return;
  }

  processPlayerImage(player).catch(() => {});
}

export async function downloadMissingImages(onProgress) {
  const players = await Player.find({
    $or: [
      { imageStatus: { $in: ['', 'pending', 'failed'] } },
      { imageStatus: { $exists: false } },
      { image: '' },
      { image: null },
    ],
  });

  const total = players.length;
  let completed = 0;
  const results = [];

  const queue = [...players];
  async function worker() {
    while (queue.length > 0) {
      const player = queue.shift();
      try {
        const slug = slugify(player.name);
        const filePath = path.join(IMAGE_DIR, `${slug}.webp`);
        if (fs.existsSync(filePath)) {
          const localPath = `/players/${slug}.webp`;
          if (player.image !== localPath || player.imageStatus !== 'ready') {
            await Player.findByIdAndUpdate(player._id, { image: localPath, imageStatus: 'ready' });
          }
          results.push({ name: player.name, status: 'cached' });
        } else {
          await processPlayerImage(player);
          results.push({ name: player.name, status: 'ok' });
        }
      } catch {
        results.push({ name: player.name, status: 'failed' });
      }
      completed++;
      if (onProgress) onProgress({ completed, total, current: player.name });
    }
  }

  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, () => worker()));
  return { total, results };
}
