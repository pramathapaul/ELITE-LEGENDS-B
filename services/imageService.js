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
  const searches = [
    `${searchName} portrait footballer`,
    `${searchName} footballer`,
    searchName,
  ];

  let pages = [];

  for (const query of searches) {
    const params = new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6',
      gsrlimit: '10',
      prop: 'imageinfo',
      iiprop: 'url|size',
      iiurlwidth: '1000',
      format: 'json',
      origin: '*',
    });

    const response = await fetch(`${WIKIMEDIA_API}?${params}`, {
      headers: {
        'User-Agent': 'FootballAuctionApp/1.0 (football@auction.app)',
      },
    });

    if (!response.ok) continue;

    const data = await response.json();

    if (data.query?.pages) {
      pages = Object.values(data.query.pages);
      if (pages.length) break;
    }
  }

  if (!pages.length) return null;

  const fullName = searchName.toLowerCase();

  const positiveKeywords = [
    'cropped',
    'portrait',
    'headshot',
    '2022',
    '2021',
    '2020',
    '2019',
    '2018',
    'fifa',
    'world cup',
  ];

  const negativeKeywords = [
    'penalty',
    'goal',
    'celebration',
    'training',
    'warmup',
    'match',
    'vs',
    'stadium',
    'signature',
    'firma',
    'autograph',
    'logo',
    'flag',
    'team',
    'squad',
    'lineup',
    'kit launch',
  ];

  let best = null;
  let bestScore = -99999;

  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;

    const url = info.url.startsWith('//')
      ? `https:${info.url}`
      : info.url;

    const ext = path.extname(url).toLowerCase();

    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) continue;

    const title = (page.title || '')
      .replace(/^File:/i, '')
      .toLowerCase();

    let score = 0;

    if (title.includes(fullName)) score += 100;

    for (const part of fullName.split(' ')) {
      if (title.includes(part)) score += 15;
    }

    for (const keyword of positiveKeywords) {
      if (title.includes(keyword)) score += 25;
    }

    for (const keyword of negativeKeywords) {
      if (title.includes(keyword)) score -= 40;
    }

    if (info.width > 1500) score += 25;
    else if (info.width > 1000) score += 15;
    else if (info.width > 700) score += 10;

    if (info.height > 1000) score += 5;

    if (info.height > info.width) score += 10;

    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }

  return best;
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
