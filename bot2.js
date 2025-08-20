const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const express = require("express");
const bodyParser = require("body-parser");

// === CONFIGURATION ===
const token = process.env.TOKEN;
const SERVER = process.env.SERVER;
const PLAN_PRICES_USDT = {
  Basic: 0,
  Advanced: 10,
  "Homo Sapien": 20,
  Hacker: 30
};
const PAYMENT_TIMEOUT = 15 * 60 * 1000;

// === INIT BOT ===
const bot = new TelegramBot(token);
const app = express();
app.use(bodyParser.json());
const WEBHOOK_URL = process.env.WEBHOOK;
bot.setWebHook(`${WEBHOOK_URL}/bot${token}`);

// === UTILITY FUNCTIONS ===
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function escapeMarkdownV2(text) {
  return text.replace(/[_*[]()~`>#+-=|{}.!\]/g, '\\$&');
}

// === WEBHOOK HANDLER ===
app.post(`/bot${token}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// === SESSION MANAGEMENT ===
const sessionFlowState = {};
const Actions = {};

app.get('/', (req, res) => res.status(200).send('Bot is running...'));

async function sendCode(phone) {
  try {
    const res = await axios.post(`${SERVER}/send_code`, { phone });
    return res.data.message === 'Code sent successfully';
  } catch (err) {
    console.error('Send code error:', err.message);
    return false;
  }
}

async function createTelegramSession(phone, code) {
  try {
    const res = await axios.post(`${SERVER}/create_session`, { phone, code });
    return res.data.session || null;
  } catch (err) {
    console.error('Session creation error:', err.message);
    return null;
  }
}

async function saveSessionToDatabase(bot, chatId, session, userId) {
  const registrationTime = Date.now();
  try {
    await axios.post(`${SERVER}/saveinfo`, {
      userId: userId.toString(),
      data: {
        session: session,
        time: registrationTime
      }
    });
  } catch (error) {
    console.error("Session Save Error:", error.message);
  }
}

// Check if user has paid
async function checkPaymentStatus(userId) {
  try {
    const res = await axios.post(`${SERVER}/checkPayment`, {
      userId: userId.toString(),
    });

    if (res.data.paid) {  
      return true; // paid  
    }  
    return false; // not paid
  } catch (error) {
    console.error("Payment Status Error:", error);
    return false;
  }
}

async function getUserStats(userId) {
  try {
    console.log("[getUserStats] Fetching stats for user:", userId);

    const res = await axios.post(`${SERVER}/getUserStats`, {  
      user_id: userId.toString()  
    });  

    console.log("[getUserStats] Raw response:", res.data);  

    // Check if response contains actual stats data  
    if (!res.data || typeof res.data !== 'object') {  
      console.log("[getUserStats] No valid stats data received");  
      return null;  
    }  

    const stats = res.data;  

    // Check if we have at least one valid stat value  
    const hasValidStats = ['clean', 'energy', 'happiness', 'health', 'hunger'].some(  
      stat => stats[stat] !== undefined && stats[stat] !== null  
    );  

    if (!hasValidStats) {  
      console.log("[getUserStats] No valid stat values found");  
      return null;  
    }  

    const result =  
      `🧼: ${stats.clean || 0}%\n` +  
      `⚡: ${stats.energy || 0}%\n` +  
      `😊: ${stats.happiness || 0}%\n` +  
      `♥️: ${stats.health || 0}%\n` +  
      `🍗: ${stats.hunger || 0}%\n\n` +  
      `🏠 Location: ${stats.in_bedroom ? "Bedroom 🛏️" : "Exploring 🌍"}\n` +  
      `💤 Status: ${stats.is_sleeping ? "Sleeping 😴" : "Awake 🐇"}\n` +  
      `🔄 Last Updated: ${stats.updatedAt ? new Date(stats.updatedAt).toLocaleTimeString() : 'Never'}`;  

    console.log("[getUserStats] Final formatted result:", result);  
    return result;
  } catch (error) {
    console.error("[getUserStats] Error fetching stats:", error.message);
    return null;
  }
}

// Wordle status
async function getWordleStatus(userId) {
  try {
    const res = await axios.post(`${SERVER}/checkWordle`, {
      userId: userId.toString()
    });

    if (res.data.exists) {  
      return {  
        text: res.data.wordle.wordle,  
        status: res.data.wordle.status  
      };  
    }  
    return {  
      text: "Not submitted yet",  
      status: "None"  
    };
  } catch (error) {
    console.error("Wordle Status Error:", error);
    return {
      text: "Error fetching",
      status: "Error"
    };
  }
}

// === MESSAGE HANDLERS ===
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const name = msg.from.username || msg.from.first_name || "User";

  try {
    // Fetch stats
    const userStats = await getUserStats(userId);

    // Check if stats exist and are valid (not empty or error messages)  
    const isRegistered = userStats && 
                        !userStats.includes("Failed to load") && 
                        !userStats.includes("No pet stats available");  

    if (!isRegistered) {
      await bot.sendMessage(chatId,
        `You Need a pet bot? open this bot send to the address payment will be confirmed then you can create 5 sessions and if you need help deploying you can join the group or use /help

🟣 Link for payment: https://t.me/Insiderrsbro_bot
👋 Group for help : https://chat.whatsapp.com/IYxW7sRLQcz7NnLHLBaowl?mode=ac_t

You can also help add and submit Wordle for Purple Bot for users to use with:
👉 /wordle {the word}`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: "Paid ✅", callback_data: "Paid" }]
            ]
          }
        }
      );
      return;
    }

    // Only show dashboard if we have valid stats  
    const wordleStatus = await getWordleStatus(userId);      
    const asciiArt = "(●   ●)\n   ᴖ";      

    const infoText =      
      `${asciiArt}\n\n` +      
      `User: ${name}\n\n` +      
      `Bot: Pet_Ai\nStats:\n${userStats}\n\n` +      
      `Today's Wordle: ${wordleStatus.text} 👉 ${      
        wordleStatus.status === "Verified"      
          ? "✅ Verified"      
          : wordleStatus.status === "Unverified"      
          ? "🕒 Pending"      
          : "❌ Not submitted"      
      }\n\n` +      
      `Status: Active ✅\n\n` +      
      `Submit Daily Wordle with /Wordle {the Word}\n\n` +      
      `Share: https://t.me/ConitioiBot`;      

    await bot.sendMessage(chatId, infoText, {      
      reply_markup: {      
        inline_keyboard: [      
          [{ text: "Errors", callback_data: "errors" }],      
          [{ text: "Support 🧸 n Help", callback_data: "chat_support" }]      
        ]      
      }      
    });
  } catch (err) {
    console.error("Start Error:", err.message);
    await bot.sendMessage(chatId, "⚠️ Failed to load user stats");

    await bot.sendMessage(
      chatId,
      `You Need a pet bot? Open this bot, send to the address, payment will be confirmed.
Then you can create 5 sessions.

If you need help deploying, you can join the group or use /help.

🟣 Link for payment: https://t.me/Insiderrsbro_bot
👋 Group for help: https://chat.whatsapp.com/IYxW7sRLQcz7NnLHLBaowl?mode=ac_t

You can also help add and submit Wordle for Purple Bot using:
👉 /wordle {the word}`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "Paid ✅", callback_data: "Paid" }]
          ]
        }
      }
    );
  }
});

bot.onText(/\/wordle (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const wordleText = match[1]; // The Wordle text after the command

  try {
    // Check if today's Wordle already exists
    const checkResponse = await axios.post(`${SERVER}/checkWordle`, {
      userId: userId.toString()
    });

    if (checkResponse.data.exists) {  
      const existingWordle = checkResponse.data.wordle;  
      const sentMessage = await bot.sendMessage(chatId,   
        `🧩 *Wordle Update* 🧩\n\n` +  
        `Someone has uploaded today's Wordle and it's *${existingWordle.status}*\n\n` +  
        `Check back later 😇\n` +  
        `More rewards coming soon! 🧸✨`,  
        { parse_mode: "Markdown" }  
      );  

      // Delete after 5 seconds  
      setTimeout(() => {  
        bot.deleteMessage(chatId, sentMessage.message_id).catch(console.error);  
      }, 5000);  
      return;  
    }  

    // Save new Wordle  
    const saveResponse = await axios.post(`${SERVER}/saveWordle`, {  
      userId: userId.toString(),  
      wordle: wordleText,  
      status: "Unverified"  
    });  

    const sentMessage = await bot.sendMessage(chatId,  
      `🎯 *Wordle Submitted Successfully!* 🎯\n\n` +  
      `✅ You've uploaded today's Wordle!\n\n` +  
      `🔍 Once verified, your rewards are *guaranteed*!\n` +  
      `🕒 Check back later for your rewards! 🎉`,  
      { parse_mode: "Markdown" }  
    );  

    // Delete after 5 seconds  
    setTimeout(() => {  
      bot.deleteMessage(chatId, sentMessage.message_id).catch(console.error);  
    }, 5000);
  } catch (error) {
    console.error("Wordle Error:", error);
    const sentMessage = await bot.sendMessage(chatId,
      "⚠️ Failed to process your Wordle. Please try again later.",
      { parse_mode: "Markdown" }
    );

    // Delete after 5 seconds  
    setTimeout(() => {  
      bot.deleteMessage(chatId, sentMessage.message_id).catch(console.error);  
    }, 5000);
  }
});

// Handle Paid button
bot.on("callback_query", async (ctx) => {
  const callbackData = ctx.data;
  
  if (callbackData === "Paid") {
    const userId = ctx.from.id;

    const hasPaid = await checkPaymentStatus(userId);

    if (!hasPaid) {
      // Not paid
      return bot.answerCallbackQuery(ctx.id, { 
        text: "You have not Paid Motherfucker 😑", 
        show_alert: true 
      });
    }

    // Paid → show create session menu
    await bot.editMessageText(
      "🎉 Thanks for your support! You can now create up to 5 sessions.",
      {
        chat_id: ctx.message.chat.id,
        message_id: ctx.message.message_id,
        reply_markup: {
          inline_keyboard: [[{ text: "Create Session", callback_data: "create_session" }]],
        },
      }
    );
  }
});

// Add this before your server start code
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// === SERVER START ===
app.listen(3000, () => {
  console.log("Webhook server running on port 3000");
});