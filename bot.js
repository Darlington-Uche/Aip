const { Telegraf } = require("telegraf");
const axios = require("axios");

// ─── Config ─────────────────────────────────
const BOT_TOKEN = "8318290994:AAHnS162xRjWGwTNs5Vdo9xEPQE3YSizkus";
const SESSION_SERVICE_URL = "http://127.0.0.1:5000";
const bot = new Telegraf(BOT_TOKEN);
const userStates = {};

// ─── Helpers ─────────────────────────────────
function clearUserState(chatId) {
    if (userStates[chatId]?.timeout) clearTimeout(userStates[chatId].timeout);
    delete userStates[chatId];
}

function setActionTimeout(chatId, ctx) {
    userStates[chatId].timeout = setTimeout(() => {
        ctx.reply("⌛ Session timed out. Use /start to begin again.");
        clearUserState(chatId);
    }, 15 * 60 * 1000);
}

// ─── Commands ────────────────────────────────
bot.start((ctx) => {
    const chatId = ctx.chat.id;
    clearUserState(chatId);

    ctx.reply(
        "Welcome to Session Creator Bot\n\nI can help you create Telegram sessions.\n\nClick below to begin:",
        {
            reply_markup: {
                inline_keyboard: [[{ text: "Get Session 🧩", callback_data: "get_session" }]]
            }
        }
    );
});

// ─── Callback Actions ────────────────────────
bot.action("get_session", (ctx) => {
    const chatId = ctx.chat.id;
    clearUserState(chatId);

    userStates[chatId] = { step: "awaiting_phone" };
    setActionTimeout(chatId, ctx);

    ctx.reply("📱 Send your phone number in international format (e.g., +123456789)");
});

// ─── Handle Messages ─────────────────────────
bot.on("text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text.trim();
    const state = userStates[chatId];
    if (!state) return;

    try {
        if (state.step === "awaiting_phone") {
            if (!/^\+\d{8,15}$/.test(text)) {
                return ctx.reply("❌ Invalid phone number. Use format like +123456789");
            }

            state.phone = text;
            state.step = "awaiting_code";
            await ctx.reply("⌛ Sending verification code...");

            const res = await axios.post(`${SESSION_SERVICE_URL}/send_code`, { phone: text });
            if (!res.data.success) throw new Error(res.data.error || "Failed to send code");

            ctx.reply("📨 Code sent! Enter it here.");
        }

        else if (state.step === "awaiting_code") {
            if (!/^\d{5,6}$/.test(text)) {
                return ctx.reply("❌ Code must be 5 or 6 digits");
            }

            await ctx.reply("⌛ Creating session...");

            const res = await axios.post(`${SESSION_SERVICE_URL}/create_session`, {
                phone: state.phone,
                code: text
            });
            if (!res.data.success) throw new Error(res.data.error || "Failed to create session");

            ctx.reply(
                `✅ Session created!\n\nYour session string:\n\`\`\`${res.data.session}\`\`\`\n\n⚠️ Do not share this with anyone!`,
                { parse_mode: "Markdown" }
            );

            clearUserState(chatId);
        }
    } catch (err) {
        ctx.reply(`❌ Error: ${err.message}\n\nUse /start to try again.`);
        clearUserState(chatId);
    }
});

// ─── Start Polling ───────────────────────────
bot.launch();
console.log("🚀 Bot running with Telegraf in polling mode...");