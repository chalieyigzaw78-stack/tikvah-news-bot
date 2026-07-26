import dotenv from 'dotenv';
dotenv.config();

import { Telegraf, Markup } from 'telegraf';
import { Pool } from 'pg';
import cron from 'node-cron';
import * as http from 'http';

const BOT_TOKEN = process.env.BOT_TOKEN!;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID!;
const GROQ_API_KEY = process.env.GROQ_API_KEY!;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Groq AI ──────────────────────────────────────────────────────────────────
const askAI = async (userMessage: string): Promise<string> => {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are an Ethiopian assistant fluent in both Amharic and English. When the user writes in Amharic, always respond in proper, natural Ethiopian Amharic using correct grammar and vocabulary. When they write in English, respond in English. Never mix languages unless necessary. Be concise, friendly, and helpful. Never fabricate news or current events.'
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 500
      })
    });
    const data = await response.json() as any;
    if (data?.error) {
      console.error('Groq error:', JSON.stringify(data.error));
      return '⚠️ Error: ' + (data.error.message || 'Unknown error');
    }
    return data?.choices?.[0]?.message?.content || '⚠️ No response from AI.';
  } catch (err) {
    console.error('Groq error:', err);
    return '⚠️ AI is temporarily unavailable. Please try again later.';
  }
};

// ─── Database ─────────────────────────────────────────────────────────────────
const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscribers (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT UNIQUE NOT NULL,
      username VARCHAR(255),
      first_name VARCHAR(255),
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
  console.log('Database initialized');
};

const saveSubscriber = async (chatId: number, username: string, firstName: string) => {
  await pool.query(
    'INSERT INTO subscribers (chat_id, username, first_name) VALUES ($1, $2, $3) ON CONFLICT (chat_id) DO NOTHING',
    [chatId, username, firstName]
  );
};

const getAllSubscribers = async (): Promise<number[]> => {
  const result = await pool.query('SELECT chat_id FROM subscribers');
  return result.rows.map((r: any) => r.chat_id);
};

const isAdmin = (chatId: number) => String(chatId) === String(ADMIN_CHAT_ID);

// ─── Bot ──────────────────────────────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

const mainMenu = Markup.keyboard([
  ['📰 Latest News', '🔥 Breaking News'],
  ['📂 Categories', '🔍 Search News'],
  ['🌍 English News', '🇪🇹 Amharic News'],
  ['🤖 Ask AI', '❓ Help'],
  ['📲 Install App'],
]).resize();

const adminMenu = Markup.keyboard([
  ['📰 Latest News', '🔥 Breaking News'],
  ['📂 Categories', '🔍 Search News'],
  ['🌍 English News', '🇪🇹 Amharic News'],
  ['🤖 Ask AI', '❓ Help'],
  ['📲 Install App'],
  ['📝 Post News', '📊 Stats'],
]).resize();

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const username = ctx.from?.username || '';
  const firstName = ctx.from?.first_name || '';
  await saveSubscriber(chatId, username, firstName);
  const menu = isAdmin(chatId) ? adminMenu : mainMenu;
  ctx.reply(
    '👋 እንኳን ደህና መጡ ' + firstName + '!\n\n' +
    '🗞️ Welcome to Tikvah News Bot!\n' +
    'Stay updated with the latest Ethiopian & world news\n' +
    'in both English and Amharic 🇪🇹\n\n' +
    '💡 Tap 🤖 Ask AI to chat with our AI assistant!\n\n' +
    'Choose an option below:',
    menu
  );
});

bot.hears('📰 Latest News', async (ctx) => {
  try {
    const result = await pool.query('SELECT * FROM news ORDER BY created_at DESC LIMIT 5');
    if (result.rows.length === 0) return ctx.reply('No news yet. Check back soon!', mainMenu);
    for (const n of result.rows) {
      let msg = '';
      if (n.title_en) msg += '📌 ' + n.title_en + '\n';
      if (n.title_am) msg += '📌 ' + n.title_am + '\n';
      msg += '📂 ' + n.category + '\n\n';
      if (n.content_en) msg += '🌍 ' + n.content_en + '\n\n';
      if (n.content_am) msg += '🇪🇹 ' + n.content_am + '\n\n';
      msg += '🕐 ' + new Date(n.created_at).toLocaleString();
      await ctx.reply(msg);
    }
    ctx.reply('─────────────────', mainMenu);
  } catch {
    ctx.reply('⚠️ Could not load news right now.', mainMenu);
  }
});

bot.hears('🔥 Breaking News', async (ctx) => {
  try {
    const result = await pool.query(
      "SELECT * FROM news WHERE category = 'Breaking' ORDER BY created_at DESC LIMIT 3"
    );
    if (result.rows.length === 0) return ctx.reply('No breaking news at the moment.', mainMenu);
    for (const n of result.rows) {
      let msg = '🔥 BREAKING NEWS\n\n';
      if (n.title_en) msg += '📌 ' + n.title_en + '\n';
      if (n.title_am) msg += '📌 ' + n.title_am + '\n\n';
      if (n.content_en) msg += '🌍 ' + n.content_en + '\n\n';
      if (n.content_am) msg += '🇪🇹 ' + n.content_am;
      await ctx.reply(msg);
    }
    ctx.reply('─────────────────', mainMenu);
  } catch {
    ctx.reply('⚠️ Could not load breaking news.', mainMenu);
  }
});

bot.hears('📂 Categories', (ctx) => {
  ctx.reply(
    '📂 News Categories:\n\n' +
    '🏛️  Politics\n💼  Business\n⚽  Sports\n' +
    '💻  Technology\n🎭  Entertainment\n' +
    '🌍  World\n🔥  Breaking\n🏥  Health\n\n' +
    'Tap 🔍 Search News and type a category to browse.',
    mainMenu
  );
});

bot.hears('🌍 English News', async (ctx) => {
  try {
    const result = await pool.query(
      'SELECT * FROM news WHERE title_en IS NOT NULL ORDER BY created_at DESC LIMIT 5'
    );
    if (result.rows.length === 0) return ctx.reply('No English news yet.', mainMenu);
    for (const n of result.rows) {
      await ctx.reply('📌 ' + n.title_en + '\n📂 ' + n.category + '\n\n' + n.content_en + '\n\n🕐 ' + new Date(n.created_at).toLocaleString());
    }
    ctx.reply('─────────────────', mainMenu);
  } catch {
    ctx.reply('⚠️ Could not load English news.', mainMenu);
  }
});

bot.hears('🇪🇹 Amharic News', async (ctx) => {
  try {
    const result = await pool.query(
      'SELECT * FROM news WHERE title_am IS NOT NULL ORDER BY created_at DESC LIMIT 5'
    );
    if (result.rows.length === 0) return ctx.reply('ዜና እስካሁን የለም።', mainMenu);
    for (const n of result.rows) {
      await ctx.reply('📌 ' + n.title_am + '\n📂 ' + n.category + '\n\n' + n.content_am + '\n\n🕐 ' + new Date(n.created_at).toLocaleString());
    }
    ctx.reply('─────────────────', mainMenu);
  } catch {
    ctx.reply('⚠️ ዜና መጫን አልተቻለም።', mainMenu);
  }
});

bot.hears('🔍 Search News', (ctx) => {
  ctx.reply('Type your search keyword:\nExample: politics', Markup.forceReply());
});

bot.hears('🤖 Ask AI', (ctx) => {
  ctx.reply(
    '🤖 AI Assistant is ready!\n\n' +
    'Ask me anything in English or Amharic:\n\n' +
    '• What is happening in Ethiopia?\n' +
    '• ስለ ጤና ጥቆማ ስጠኝ\n' +
    '• Tell me about Ethiopian history\n\n' +
    'Just type your question! 👇'
  );
});

bot.hears('📲 Install App', (ctx) => {
  ctx.reply(
    '📲 Install Tikvah News as an App:\n\n' +
    '🤖 Android (Chrome):\n' +
    '1. Open Chrome browser\n' +
    '2. Tap the 3 dots menu ⋮\n' +
    '3. Tap "Add to Home Screen"\n' +
    '4. Tap "Add" — done! ✅\n\n' +
    '🍎 iPhone (Safari):\n' +
    '1. Open Safari browser\n' +
    '2. Tap the Share button ⬆️\n' +
    '3. Tap "Add to Home Screen"\n' +
    '4. Tap "Add" — done! ✅',
    mainMenu
  );
});

bot.hears('❓ Help', (ctx) => {
  ctx.reply(
    '📖 How to use Tikvah News Bot:\n\n' +
    '📰 Latest News — newest stories\n' +
    '🔥 Breaking News — urgent updates\n' +
    '📂 Categories — browse by topic\n' +
    '🔍 Search News — search by keyword\n' +
    '🌍 English News — English only\n' +
    '🇪🇹 Amharic News — Amharic only\n' +
    '🤖 Ask AI — chat with AI assistant\n\n' +
    '📩 To report news tips, contact us on Telegram.',
    mainMenu
  );
});

bot.hears('📝 Post News', (ctx) => {
  if (!isAdmin(ctx.chat.id)) return ctx.reply('⛔ Admin only.', mainMenu);
  ctx.reply(
    '📝 Post a new story. Send in this format:\n\n' +
    'TITLE_EN: Your English title\n' +
    'TITLE_AM: የአማርኛ ርዕስ\n' +
    'CATEGORY: Politics\n' +
    'CONTENT_EN: English content here\n' +
    'CONTENT_AM: የአማርኛ ይዘት እዚህ\n\n' +
    'Categories: Breaking, Politics, Business, Sports, Technology, Entertainment, World, Health'
  );
});

bot.hears('📊 Stats', async (ctx) => {
  if (!isAdmin(ctx.chat.id)) return ctx.reply('⛔ Admin only.', mainMenu);
  try {
    const subs = await pool.query('SELECT COUNT(*) FROM subscribers');
    const news = await pool.query('SELECT COUNT(*) FROM news');
    const today = await pool.query(
      "SELECT COUNT(*) FROM news WHERE created_at >= NOW() - INTERVAL '24 hours'"
    );
    ctx.reply(
      '📊 Tikvah News Bot Stats:\n\n' +
      '👥 Total Subscribers: ' + subs.rows[0].count + '\n' +
      '📰 Total News Posted: ' + news.rows[0].count + '\n' +
      '📅 News Today: ' + today.rows[0].count
    );
  } catch {
    ctx.reply('⚠️ Could not load stats.');
  }
});

bot.on('text', async (ctx) => {
  const text = (ctx.message as any)?.text || '';
  if (text.startsWith('/')) return;

  const adminPosting = isAdmin(ctx.chat.id) && (text.includes('TITLE_EN:') || text.includes('TITLE_AM:'));
  if (adminPosting) {
    try {
      const getField = (field: string): string | null => {
        const regex = new RegExp(field + ':\\s*([\\s\\S]+?)(?=\\n[A-Z_]+:|$)');
        const match = text.match(regex);
        return match ? match[1].trim() : null;
      };
      const title_en = getField('TITLE_EN');
      const title_am = getField('TITLE_AM');
      const content_en = getField('CONTENT_EN');
      const content_am = getField('CONTENT_AM');
      const category = getField('CATEGORY') || 'General';
      await pool.query(
        'INSERT INTO news (title_en, title_am, content_en, content_am, category, posted_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [title_en, title_am, content_en, content_am, category, ctx.chat.id]
      );
      const subscribers = await getAllSubscribers();
      let message = '📰 NEW: ' + category + '\n\n';
      if (title_en) message += '📌 ' + title_en + '\n';
      if (title_am) message += '📌 ' + title_am + '\n\n';
      if (content_en) message += '🌍 ' + content_en + '\n\n';
      if (content_am) message += '🇪🇹 ' + content_am;
      let sent = 0;
      for (const chatId of subscribers) {
        try { await bot.telegram.sendMessage(chatId, message); sent++; } catch {}
      }
      ctx.reply('✅ News posted and sent to ' + sent + ' subscribers!', adminMenu);
    } catch {
      ctx.reply('⚠️ Failed to post news. Check the format and try again.');
    }
    return;
  }

  // Search DB first
  try {
    const result = await pool.query(
      'SELECT * FROM news WHERE title_en ILIKE $1 OR title_am ILIKE $1 OR content_en ILIKE $1 OR content_am ILIKE $1 OR category ILIKE $1 ORDER BY created_at DESC LIMIT 3',
      ['%' + text + '%']
    );
    if (result.rows.length > 0) {
      for (const n of result.rows) {
        let msg = '';
        if (n.title_en) msg += '📌 ' + n.title_en + '\n';
        if (n.title_am) msg += '📌 ' + n.title_am + '\n';
        msg += '📂 ' + n.category + '\n\n';
        if (n.content_en) msg += '🌍 ' + n.content_en + '\n\n';
        if (n.content_am) msg += '🇪🇹 ' + n.content_am;
        await ctx.reply(msg);
      }
      ctx.reply('─────────────────', mainMenu);
      return;
    }
  } catch {}

  // Ask Groq AI
  await ctx.reply('🤖 Let me think about that...');
  const aiResponse = await askAI(text);
  ctx.reply('🤖 AI:\n\n' + aiResponse, mainMenu);
});

// ─── Daily Digest 7AM ─────────────────────────────────────────────────────────
cron.schedule('0 7 * * *', async () => {
  try {
    const result = await pool.query('SELECT * FROM news ORDER BY created_at DESC LIMIT 3');
    if (result.rows.length === 0) return;
    const subscribers = await getAllSubscribers();
    let digest = '🌅 Good Morning! ብሩህ ቀን!\n\n📰 Today\'s Top News:\n\n';
    result.rows.forEach((n: any, i: number) => {
      if (n.title_en) digest += (i + 1) + '. ' + n.title_en + '\n';
      if (n.title_am) digest += '   ' + n.title_am + '\n';
      digest += '\n';
    });
    digest += 'Have a great day! 🌟';
    for (const chatId of subscribers) {
      try { await bot.telegram.sendMessage(chatId, digest); } catch {}
    }
  } catch (err) {
    console.error('Morning digest error:', err);
  }
}, { timezone: 'Africa/Addis_Ababa' });

// ─── Start ────────────────────────────────────────────────────────────────────
const start = async () => {
  await initDB();
  bot.launch();
  console.log('Tikvah News Bot is running!');
  const PORT = process.env.PORT || 3000;
  http.createServer((_: any, res: any) => {
    res.writeHead(200);
    res.end('Tikvah News Bot is running!');
  }).listen(PORT, () => {
    console.log('HTTP server listening on port ' + PORT);
  });
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
};

start();
