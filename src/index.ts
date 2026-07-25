import dotenv from 'dotenv';
dotenv.config();

import { Telegraf, Markup } from 'telegraf';
import { Pool } from 'pg';
import cron from 'node-cron';

const BOT_TOKEN = process.env.BOT_TOKEN!;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID!;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Database Setup ───────────────────────────────────────────────────────────
const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT UNIQUE NOT NULL,
      username VARCHAR(255),
      first_name VARCHAR(255),
      language VARCHAR(10) DEFAULT 'both',
      joined_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      title_en TEXT,
      title_am TEXT,
      content_en TEXT,
      content_am TEXT,
      category VARCHAR(100) DEFAULT 'General',
      posted_by BIGINT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('✅ Database initialized');
};

const saveSubscriber = async (chatId: number, username: string, firstName: string) => {
  await pool.query(
    `INSERT INTO subscribers (chat_id, username, first_name)
     VALUES ($1, $2, $3) ON CONFLICT (chat_id) DO NOTHING`,
    [chatId, username, firstName]
  );
};

const getAllSubscribers = async (): Promise<number[]> => {
  const result = await pool.query('SELECT chat_id FROM subscribers');
  return result.rows.map((r: any) => r.chat_id);
};

const isAdmin = (chatId: number) => String(chatId) === String(ADMIN_CHAT_ID);

// ─── Bot Setup ────────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

const mainMenu = Markup.keyboard([
  ['📰 Latest News', '🔥 Breaking News'],
  ['📂 Categories', '🔍 Search News'],
  ['🌍 English News', '🇪🇹 Amharic News'],
  ['📲 Install App', '❓ Help'],
]).resize();

const adminMenu = Markup.keyboard([
  ['📰 Latest News', '🔥 Breaking News'],
  ['📂 Categories', '🔍 Search News'],
  ['🌍 English News', '🇪🇹 Amharic News'],
  ['📲 Install App', '❓ Help'],
  ['📝 Post News', '📊 Stats'],
]).resize();

// ─── Start ────────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const username = ctx.from?.username || '';
  const firstName = ctx.from?.first_name || '';
  await saveSubscriber(chatId, username, firstName);

  const menu = isAdmin(chatId) ? adminMenu : mainMenu;
  ctx.reply(
    `👋 እንኳን ደህና መጡ ${firstName}!\n\n` +
    `🗞️ Welcome to Tikvah News Bot!\n` +
    `Stay updated with the latest Ethiopian & world news\n` +
    `in both English and Amharic 🇪🇹\n\n` +
    `Choose an option below:`,
    menu
  );
});

// ─── Latest News ──────────────────────────────────────────────────────────────
bot.hears('📰 Latest News', async (ctx) => {
  try {
    const result = await pool.query(
      `SELECT * FROM news ORDER BY created_at DESC LIMIT 5`
    );
    if (result.rows.length === 0) return ctx.reply('No news yet. Check back soon! 📰', mainMenu);

    for (const news of result.rows) {
      let message = '';
      if (news.title_en) message += `📌 ${news.title_en}\n`;
      if (news.title_am) message += `📌 ${news.title_am}\n`;
      message += `📂 ${news.category}\n\n`;
      if (news.content_en) message += `🌍 ${news.content_en}\n\n`;
      if (news.content_am) message += `🇪🇹 ${news.content_am}\n\n`;
      message += `🕐 ${new Date(news.created_at).toLocaleString()}`;
      await ctx.reply(message);
    }
    ctx.reply('─────────────────', mainMenu);
  } catch {
    ctx.reply('⚠️ Could not load news right now.', mainMenu);
  }
});

// ─── Breaking News ────────────────────────────────────────────────────────────
bot.hears('🔥 Breaking News', async (ctx) => {
  try {
    const result = await pool.query(
      `SELECT * FROM news WHERE category = 'Breaking' ORDER BY created_at DESC LIMIT 3`
    );
    if (result.rows.length === 0) return ctx.reply('No breaking news at the moment. 📰', mainMenu);

    for (const news of result.rows) {
      let message = `🔥 BREAKING NEWS\n\n`;
      if (news.title_en) message += `📌 ${news.title_en}\n`;
      if (news.title_am) message += `📌 ${news.title_am}\n\n`;
      if (news.content_en) message += `🌍 ${news.content_en}\n\n`;
      if (news.content_am) message += `🇪🇹 ${news.content_am}`;
      await ctx.reply(message);
    }
    ctx.reply('─────────────────', mainMenu);
  } catch {
    ctx.reply('⚠️ Could not load breaking news.', mainMenu);
  }
});

// ─── Categories ───────────────────────────────────────────────────────────────
bot.hears('📂 Categories', (ctx) => {
  ctx.reply(
    `📂 News Categories:\n\n` +
    `🏛️  Politics\n` +
    `💼  Business\n` +
    `⚽  Sports\n` +
    `💻  Technology\n` +
    `🎭  Entertainment\n` +
    `🌍  World\n` +
    `🔥  Breaking\n` +
    `🏥  Health\n\n` +
    `Tap 🔍 Search News and type a category to browse.`,
    mainMenu
  );
});

// ─── English News ─────────────────────────────────────────────────────────────
bot.hears('🌍 English News', async (ctx) => {
  try {
    const result = await pool.query(
      `SELECT * FROM news WHERE title_en IS NOT NULL ORDER BY created_at DESC LIMIT 5`
    );
    if (result.rows.length === 0) return ctx.reply('No English news yet.', mainMenu);

    for (const news of result.rows) {
      let message = `📌 ${news.title_en}\n📂 ${news.category}\n\n${news.content_en}\n\n🕐 ${new Date(news.created_at).toLocaleString()}`;
      await ctx.reply(message);
    }
    ctx.reply('─────────────────', mainMenu);
  } catch {
    ctx.reply('⚠️ Could not load English news.', mainMenu);
  }
});

// ─── Amharic News ─────────────────────────────────────────────────────────────
bot.h
