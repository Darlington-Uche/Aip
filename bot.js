// index.js
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const express = require("express");

// --- CONFIG ---
const token = process.env.TOKEN || process.env.Token;
const SESSION_SERVER = process.env.SESSION_SERVER || "https://pettai-darlington-session.onrender.com";
const WEBHOOK_URL = process.env.WEBHOOK_URL; // e.g. https://bot-9q9m.onrender.com
const PORT = process.env.PORT || 3000;

if (!token) {
  console.error("Missing bot token. Set process.env.TOKEN or process.env.Token");
  process.exit(1);
}
if (!WEBHOOK_URL) {
  console.error("Missing WEBHOOK_URL env var (e.g. https://your-app.onrender.com)");
  process.exit(1);
}

// --- INIT ---
const bot = new TelegramBot(token, { webHook: true });
const app = express();
const userStates = {};

app.use(express.json());

// health
app.get("/", (req, res) => res.send("OK"));

// Telegram will POST updates here
app.post("/webhook", (req, res) => {
  try {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  } catch (err) {
    console.error("processUpdate error:", err);
    res.sendStatus(500);
  }
});

// Helper: clear user state and delete tracked messages
async function clearUserState(chatId) {
  const state = userStates[chatId];
  if (!state) return;
  try {
    if (state.timeout) clearTimeout(state.timeout);

    if (state.processingMsgId) {
      await bot.deleteMessage(chatId, state.processingMsgId).catch(() => {});
    }

    if (state.messagesToDelete && Array.isArray(state.messagesToDelete)) {
      for (const msgId of state.messagesToDelete) {
        await bot.deleteMessage(chatId, msgId).catch(() => {});
      }
    }
  } catch (e) {
    console.error("Error clearing user state:", e.message);
  } finally {
    delete userStates[chatId];
  }
}

// Timeout helper (15 minutes)
function setActionTimeout(chatId) {
  if (!userStates[chatId]) return;
  userStates[chatId].timeout = setTimeout(async () => {
    try {
      const timeoutMsg = await bot.sendMessage(
        chatId,
        "⌛ Session creation timed out. Please start again with /start",
        { parse_mode: "MarkdownV2" }
      );

      userStates[chatId].messagesToDelete = userStates[chatId].messagesToDelete || [];
      userStates[chatId].messagesToDelete.push(timeoutMsg.message_id);
    } catch (e) {
      console.error("Error sending timeout message:", e.message);
    } finally {
      await clearUserState(chatId);
    }
  }, 15 * 60 * 1000);
}

// schedule message deletion (default 2 minutes)
function scheduleMessageDeletion(chatId, msgId, delay = 2 * 60 * 1000) {
  setTimeout(async () => {
    try {
      await bot.deleteMessage(chatId, msgId);
    } catch (e) {
      // ignore deletion errors
    }
  }, delay);
}

// --- Handlers ---
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await clearUserState(chatId).catch(() => {});

  try {
    // delete command message if possible
    await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
  } catch (e) {}

  const welcomeMsg = await bot.sendMessage(
    chatId,
    "*Welcome to Session Creator Bot*\n\nI can help you create Telegram sessions\n\nClick below to begin:",
    {
      parse_mode: "MarkdownV2",
      reply_markup: {
        inline_keyboard: [[{ text: "Get Session 🧩", callback_data: "get_session" }]]
      }
    }
  );

  userStates[chatId] = { messagesToDelete: [welcomeMsg.message_id] };
  scheduleMessageDeletion(chatId, welcomeMsg.message_id);
});

bot.on("callback_query", async (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === "get_session") {
    await clearUserState(chatId).catch(() => {});
    userStates[chatId] = { step: "awaiting_phone", messagesToDelete: [query.message.message_id] };
    setActionTimeout(chatId);

    const phonePrompt = await bot.sendMessage(
      chatId,
      "📱 Please send your phone number in international format (e.g., +123456789)\n\n*Note:* This should be the number of the account you want to create session for.",
      { parse_mode: "MarkdownV2" }
    );

    userStates[chatId].processingMsgId = phonePrompt.message_id;
    userStates[chatId].messagesToDelete.push(phonePrompt.message_id);
  }

  // answer callback so the loading spinner stops
  await bot.answerCallbackQuery(query.id).catch(() => {});
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : "";

  if (!userStates[chatId]) return;

  try {
    userStates[chatId].messagesToDelete = userStates[chatId].messagesToDelete || [];
    if (msg.message_id) userStates[chatId].messagesToDelete.push(msg.message_id);

    if (userStates[chatId].step === "awaiting_phone") {
      // delete user's phone message to keep it private
      await bot.deleteMessage(chatId, msg.message_id).catch(() => {});

      if (!text.match(/^\+\d{8,15}$/)) {
        throw new Error("Invalid phone format. Use international format (e.g., +123456789)");
      }

      userStates[chatId].phone = text;
      userStates[chatId].step = "awaiting_code";
      setActionTimeout(chatId);

      const processingMsg = await bot.sendMessage(chatId, "⌛ Sending verification code to your Telegram account.", { parse_mode: "MarkdownV2" });
      userStates[chatId].processingMsgId = processingMsg.message_id;
      userStates[chatId].messagesToDelete.push(processingMsg.message_id);

      // send code to session server
      const response = await axios.post(`${SESSION_SERVER}/send_code`, { phone: text });
      if (!response.data || response.data.success !== true) {
        throw new Error(response.data?.error || "Failed to send verification code");
      }

      await bot.editMessageText("📨 Verification code sent! Please enter the code you received.", {
        chat_id: chatId,
        message_id: userStates[chatId].processingMsgId,
        parse_mode: "MarkdownV2"
      });

    } else if (userStates[chatId].step === "awaiting_code") {
      await bot.deleteMessage(chatId, msg.message_id).catch(() => {});

      if (!text.match(/^\d{5,6}$/)) {
        throw new Error("Invalid code format. Please enter a 5-6 digit code");
      }

      const processingMsg = await bot.sendMessage(chatId, "⌛ Creating session.", { parse_mode: "MarkdownV2" });
      userStates[chatId].processingMsgId = processingMsg.message_id;
      userStates[chatId].messagesToDelete.push(processingMsg.message_id);

      // create session on session server
      const response = await axios.post(`${SESSION_SERVER}/create_session`, {
        phone: userStates[chatId].phone,
        code: text
      });

      if (!response.data || response.data.success !== true) {
        throw new Error(response.data?.error || "Failed to create session");
      }

      const successMsg = await bot.sendMessage(
        chatId,
        "*✅ Session created successfully!* \n\nHere is your session string:\n\n" +
          "```\n" + response.data.session + "\n```\n\n" +
          "*⚠️ Keep this safe and don't share it with anyone!*",
        { parse_mode: "MarkdownV2" }
      );

      scheduleMessageDeletion(chatId, successMsg.message_id);
      await clearUserState(chatId);
    }
  } catch (error) {
    console.error(`Error for chat ${chatId}:`, error.message);

    const errorMessage = `*❌ Error:* ${error.message}\n\nPlease try again with /start`;
    const errorMsg = await bot.sendMessage(chatId, errorMessage, { parse_mode: "MarkdownV2" }).catch(() => null);
    if (errorMsg) scheduleMessageDeletion(chatId, errorMsg.message_id);
    await clearUserState(chatId);
  }
});

// --- Start server and set webhook ---
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Setting webhook to ${WEBHOOK_URL}/webhook ...`);

  try {
    // delete previous webhook & pending updates (safe)
    await axios.get(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`);

    // set new webhook
    const setRes = await axios.get(`https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(`${WEBHOOK_URL}/webhook`)}`);
    if (setRes.data && setRes.data.ok) {
      console.log("Webhook set successfully");
    } else {
      console.warn("setWebhook response:", setRes.data);
    }
  } catch (e) {
    console.error("Failed to set webhook automatically:", e.message || e);
  }
});