const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios");
const express = require("express");

// Configuration
const token = process.env.Token;
const SESSION_SERVICE_URL = process.env.SERVER_URL;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const PORT = process.env.PORT || 3000;

// Initialize bot (without polling)
const bot = new TelegramBot(token);
const app = express();
const userStates = {};

// Middleware to parse JSON
app.use(express.json());

// Set webhook route (call this once to setup)
app.get('/set-webhook', async (req, res) => {
    try {
        await bot.setWebHook(`${WEBHOOK_URL}/webhook`);
        res.send('Webhook set successfully');
    } catch (error) {
        res.status(500).send('Error setting webhook: ' + error.message);
    }
});

// Webhook endpoint
app.post('/webhook', (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Webhook URL: ${WEBHOOK_URL}/webhook`);
});

// Utility: Clear state
function clearUserState(chatId) {
    if (userStates[chatId]?.timeout) {
        clearTimeout(userStates[chatId].timeout);
    }
    delete userStates[chatId];
}

// Utility: Timeout user session after 15 mins
function setActionTimeout(chatId) {
    userStates[chatId].timeout = setTimeout(async () => {
        await bot.sendMessage(chatId, "⌛ Session timed out. Use /start to begin again.", { 
            parse_mode: "MarkdownV2" 
        });
        clearUserState(chatId);
    }, 15 * 60 * 1000);
}

// ───────────────────────────────────────────────────────
// Start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await clearUserState(chatId);

    await bot.sendMessage(chatId,
        `*Welcome to Session Creator Bot*\n\n` +
        `I can help you create Telegram sessions.\n\nClick below to begin:`,
        {
            parse_mode: "MarkdownV2",
            reply_markup: {
                inline_keyboard: [[{ text: "Get Session 🧩", callback_data: "get_session" }]]
            }
        }
    );
});

// ───────────────────────────────────────────────────────
// Handle button clicks
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    await clearUserState(chatId);

    if (data === "get_session") {
        userStates[chatId] = { step: "awaiting_phone" };
        setActionTimeout(chatId);

        await bot.sendMessage(chatId,
            "📱 Send your phone number in *international format* (e.g., `+123456789`)",
            { parse_mode: "MarkdownV2" }
        );
    }
});

// ───────────────────────────────────────────────────────
// Handle user input
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    
    // Skip if it's not a text message or if user has no state
    if (!text || !userStates[chatId]) return;
    
    const state = userStates[chatId];

    try {
        if (state.step === "awaiting_phone") {
            if (!/^\+\d{8,15}$/.test(text)) {
                throw new Error("Invalid phone number. Use format like `+123456789`");
            }

            state.phone = text;
            state.step = "awaiting_code";

            await bot.sendMessage(chatId, "⌛ Sending verification code...", { 
                parse_mode: "MarkdownV2" 
            });

            const res = await axios.post(`${SESSION_SERVICE_URL}/send_code`, { phone: text });
            if (!res.data.success) {
                throw new Error(res.data.error || "Failed to send code");
            }

            await bot.sendMessage(chatId, "📨 Code sent! Enter it here.", { 
                parse_mode: "MarkdownV2" 
            });

        } else if (state.step === "awaiting_code") {
            if (!/^\d{5,6}$/.test(text)) {
                throw new Error("Code must be 5 or 6 digits");
            }

            await bot.sendMessage(chatId, "⌛ Creating session...", { 
                parse_mode: "MarkdownV2" 
            });

            const res = await axios.post(`${SESSION_SERVICE_URL}/create_session`, {
                phone: state.phone,
                code: text
            });

            if (!res.data.success) {
                throw new Error(res.data.error || "Failed to create session");
            }

            await bot.sendMessage(chatId,
                "*✅ Session created\\!*\n\n" +
                "Your session string:\n" +
                `\`\`\`${res.data.session}\`\`\`\n\n` +
                "*⚠️ Do not share this with anyone\\!*",
                { parse_mode: "MarkdownV2" }
            );

            clearUserState(chatId);
        }

    } catch (err) {
        await bot.sendMessage(chatId,
            `*❌ Error:* ${err.message.replaceAll('_', '\\_')}\n\nUse /start to try again.`,
            { parse_mode: "MarkdownV2" }
        );
        clearUserState(chatId);
    }
});