import asyncio
import re
import os
import time
import logging
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.custom import Message
from dotenv import load_dotenv
import httpx
from typing import Dict, Tuple, List, Optional
from flask import Flask
import threading
import json
from collections import defaultdict
import random
import requests
# ----------------------------
# Configuration and Logging
# ----------------------------
# Track active monitoring tasks
active_tasks = {}
load_dotenv()

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

SERVER_URL = os.getenv('SERVER', '')
API_ID = int(os.getenv('API_ID', 0))
API_HASH = os.getenv('API_HASH', '')
BOT_USERNAME = os.getenv('BOT_USERNAME', '')

# ----------------------------
# Client Management
# ----------------------------
app = Flask(__name__)

@app.route('/')
def home():
    return "Hello!"


# ----------------------------
# Rate Limiting Configuration
# ----------------------------
RATE_LIMITS = {
    "chatgpt": (5, 60),    # 5 requests per minute
    "gemini": (10, 60),    # 10 requests per minute
    "mistral": (15, 60),   # 15 requests per minute
    "huggingface": (5, 60), # 5 requests per minute
    "ollama": (30, 60)     # 30 requests per minute (local)
}

# Track request timestamps per user per provider
request_history = defaultdict(lambda: defaultdict(list))

async def rate_limit_delay(user_id: int, provider: str) -> None:
    """Add delay if needed to comply with rate limits."""
    if provider not in RATE_LIMITS:
        return

    max_requests, time_window = RATE_LIMITS[provider]
    now = time.time()

    # Remove old requests from history
    user_history = request_history[user_id][provider]
    user_history = [t for t in user_history if now - t < time_window]
    request_history[user_id][provider] = user_history

    # If we've hit the limit, calculate delay needed
    if len(user_history) >= max_requests:
        oldest_request = user_history[0]
        time_remaining = time_window - (now - oldest_request)
        if time_remaining > 0:
            await asyncio.sleep(time_remaining + 0.1)  # Small buffer

    # Record this request
    request_history[user_id][provider].append(now)

# ----------------------------
# AI Decision Making System with Multi-Provider Fallback
# ----------------------------
MISTRAL_API_KEY = os.getenv('MISTRAL_AI', '')
ANTHROPIC_API_KEY = "your_anthropic_key_here"          # Leave empty if not using
GEMINI_API_KEY = os.getenv('GEMINI', 'AIzaSyD_3x_KbSS7jYB0jjLwlBO45tTqNEEKaA8') 
OPENAI_API_KEY = os.getenv('OPEN_AI', '')          # Leave empty if not using
HF_API_KEY = "your_huggingface_key_here"               # Leave empty if not using

AI_PROVIDERS = [
    "chatgpt",
    "gemini",
    "mistral",
    "huggingface",
    "ollama"
]

async def get_ai_decision(stats: Dict[str, any], user_id: int) -> Dict[str, any]:
    """Use AI to make intelligent decisions about pet care with multiple fallback providers."""
    pet_care_context = """
    Read instructions first You have been warned
    You are an AI pet caretaker. Based on the pet's current stats and available information, decide what action to take.
    use your sense take care like human being don't make one thing a major action 

    AVAILABLE ACTIONS:
    1. "feed" - Navigate to kitchen and feed pet
       - Don't feed pet again if Hunger > 50 
       - once Hunger > 50 nothing adds again cause pet is full
       - Increases: Health +5%, Happiness +5%, Hunger +15%
       - Requires: Health > 25 (otherwise pet too sick to eat - call emergency)
     
    2. "bathe" - Navigate to bathroom and clean pet  
       - Increases: Clean to 100%, Happiness +2%
       - Requires: Hunger not too low, not too sad, health not too low
       
    3. "sleep" - Navigate to bedroom and put pet to sleep
       - Increases: Energy (1 per minute, or 100 instantly if pet in good mood)
       - Blocks all other actions until wake up
       - if energy is low life reduces a bit faster sleeping helps boost xp
       - Sleep is essential, if pet is already sleeping send -wait action-
       - if energy < 20 = critical put pet to sleep and leave it till it is greater 
         40 ✅ 
       - when pet is sleeping don't wake up unless if energy is at a good level

    4. "wake" - Wake pet up from sleep
       - Allows other actions to be performed
       
    5. "play" - Navigate to game room and play games
       - Increases: Happiness +8%, XP (hidden)
       - Decreases: Health -5%, Energy -8%, Clean -4%, Hunger -7%
       - only works if energy is > 20
       - if pet has slept and hes ok it advisable to wake him and play game to improve his Xp
       - if pet engery is high it means he can play game 
       
    6. "emergency" - Emergency care when pet health critical
       - Restores pet health when too low for other actions
       - Required when health < 25
       
    7. "wait" - No action needed, monitor and wait

    CURRENT PET STATUS:
    - Energy: {energy}%
    - Clean: {clean}%  
    - Health: {health}%
    - Hunger: {hunger}%
    - Happiness: {happiness}%
    - Is Sleeping: {is_sleeping}
     
    if Sleeping is true and you want the pet to sleep dont call the put to sleep fuction call wait function since the pet is asleep 
    if pet energy is above > 50 you can play games if other stats is good 
     
    above is good below is bad pls read provide information well and understand 
    if energy is > 60 make sure pet is awake 

    Priority should be: You think and decide 
    
    Respond with exactly this JSON format, nothing else:
    {{
        "action": "action_name",
        "reasoning": "brief explanation of why this action was chosen",
        "priority": "high/medium/low"
    }}
    """

    prompt = pet_care_context.format(
        energy=stats['energy'],
        clean=stats['clean'],
        health=stats['health'],
        hunger=stats['hunger'],
        happiness=stats['happiness'],
        is_sleeping=stats['is_sleeping']
    )

    # Try each provider in order until we get a successful response
    for provider in AI_PROVIDERS:
        try:
            # Add rate limiting delay
            await rate_limit_delay(user_id, provider)

            if provider == "chatgpt":
                decision = await _call_chatgpt(prompt, user_id)
            elif provider == "gemini":
                decision = await _call_gemini(prompt, user_id)
            elif provider == "mistral":
                decision = await _call_mistral(prompt, user_id)
            elif provider == "huggingface":
                decision = await _call_huggingface(prompt, user_id)
            elif provider == "ollama":
                decision = await _call_ollama(prompt, user_id)

            if decision:
                logger.info(f"Used {provider} for user {user_id}")
                return decision

        except Exception as e:
            logger.warning(f"Provider {provider} failed: {str(e)}")
            continue

    # If all providers fail, use fallback
    logger.error("All AI providers failed, using fallback decision")
    return get_fallback_decision(stats)

# [Rest of your existing functions]

# --- Provider Specific Implementations ---

async def _call_chatgpt(prompt: str, user_id: int) -> Optional[Dict[str, any]]:
    """Call OpenAI ChatGPT API"""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}"
    }

    data = {
        "model": "gpt-3.5-turbo",  # or "gpt-4" if you have access
        "messages": [
            {"role": "user", "content": prompt}
        ],
        "response_format": { "type": "json_object" }  # request JSON response
    }

    async with httpx.AsyncClient(timeout=30) as client:
        url = "https://api.openai.com/v1/chat/completions"
        response = await client.post(url, headers=headers, json=data)
        if response.status_code == 200:
            result = response.json()
            return _parse_ai_response(result["choices"][0]["message"]["content"])
    return None

async def _call_anthropic(prompt: str, user_id: int) -> Optional[Dict[str, any]]:
    """Call Anthropic's Claude API"""
    headers = {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
    }

    data = {
        "model": "claude-3-sonnet-20240229",
        "max_tokens": 300,
        "messages": [{"role": "user", "content": prompt}]
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post("https://api.anthropic.com/v1/messages", headers=headers, json=data)
        if response.status_code == 200:
            result = response.json()
            return _parse_ai_response(result["content"][0]["text"])
    return None

async def _call_mistral(prompt: str, user_id: int) -> Optional[Dict[str, any]]:
    """Call Mistral API"""
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {MISTRAL_API_KEY}"
    }

    data = {
        "model": "mistral-small",
        "messages": [{"role": "user", "content": prompt}],
        "response_format": {"type": "json_object"}
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post("https://api.mistral.ai/v1/chat/completions", headers=headers, json=data)
        if response.status_code == 200:
            result = response.json()
            return _parse_ai_response(result["choices"][0]["message"]["content"])
    return None

async def _call_gemini(prompt: str, user_id: int) -> Optional[Dict[str, any]]:
    """Call Google Gemini API"""
    headers = {
        "Content-Type": "application/json"
    }

    data = {
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "response_mime_type": "application/json"
        }
    }

    async with httpx.AsyncClient(timeout=30) as client:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}"
        response = await client.post(url, headers=headers, json=data)
        if response.status_code == 200:
            result = response.json()
            return _parse_ai_response(result["candidates"][0]["content"]["parts"][0]["text"])
    return None

async def _call_huggingface(prompt: str, user_id: int) -> Optional[Dict[str, any]]:
    """Call HuggingFace Inference API"""
    headers = {
        "Authorization": f"Bearer {HF_API_KEY}",
        "Content-Type": "application/json"
    }

    data = {
        "inputs": prompt,
        "parameters": {
            "return_full_text": False,
            "max_new_tokens": 300
        }
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.1",
            headers=headers,
            json=data
        )
        if response.status_code == 200:
            result = response.json()
            return _parse_ai_response(result[0]["generated_text"])
    return None

async def _call_ollama(prompt: str, user_id: int) -> Optional[Dict[str, any]]:
    """Call local Ollama API"""
    data = {
        "model": "mistral",
        "prompt": prompt,
        "format": "json",
        "stream": False
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post("http://localhost:11434/api/generate", json=data)
        if response.status_code == 200:
            result = response.json()
            return _parse_ai_response(result["response"])
    return None

def _parse_ai_response(response_text: str) -> Dict[str, any]:
    """Parse AI response from any provider into standard format"""
    try:
        # First try to parse as pure JSON
        response_json = json.loads(response_text)
        if all(key in response_json for key in ["action", "reasoning", "priority"]):
            return response_json
    except json.JSONDecodeError:
        pass

    # Fallback parsing for non-JSON responses
    response_lower = response_text.lower()
    actions = ["feed", "bathe", "sleep", "wake", "play", "emergency", "wait"]
    detected_action = "wait"

    for action in actions:
        if action in response_lower:
            detected_action = action
            break

    return {
        "action": detected_action,
        "reasoning": "Parsed from AI text response",
        "priority": "medium"
    }




def parse_ai_response_fallback(response: str) -> Dict[str, any]:
    """Fallback parser for non-JSON AI responses."""
    response_lower = response.lower()

    actions = ["feed", "bathe", "sleep", "wake", "play", "emergency", "wait"]
    detected_action = "wait"

    for action in actions:
        if action in response_lower:
            detected_action = action
            break

    return {
        "action": detected_action,
        "reasoning": "Parsed from Grok AI text response",
        "priority": "medium"
    }

def get_fallback_decision(stats: Dict[str, any]) -> Dict[str, any]:
    """Fallback decision logic when AI is unavailable."""
    # Emergency situations
    if stats['health'] < 25:
        return {"action": "emergency", "reasoning": "Critical health - emergency needed", "priority": "high"}

    # Basic needs
    if stats['is_sleeping'] and stats['energy'] > 45:
        return {"action": "wake", "reasoning": "Pet well-rested, should wake up", "priority": "medium"}

    if not stats['is_sleeping'] and stats['hunger'] < 30:
        return {"action": "feed", "reasoning": "Pet is hungry", "priority": "high"}

    if not stats['is_sleeping'] and stats['energy'] < 20:
        return {"action": "sleep", "reasoning": "Pet needs rest", "priority": "high"}

    if not stats['is_sleeping'] and stats['clean'] < 40:
        return {"action": "bathe", "reasoning": "Pet needs cleaning", "priority": "medium"}

    if not stats['is_sleeping'] and stats['happiness'] < 40 and stats['energy'] > 40:
        return {"action": "play", "reasoning": "Pet needs fun", "priority": "low"}

    return {"action": "wait", "reasoning": "All stats acceptable", "priority": "low"}
# ----------------------------
# Server Communication
# ----------------------------
async def log_pet_error(user_id: int, error_message: str) -> None:
    """Log errors to the server."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{SERVER_URL}/UserErrors",
                json={"user_id": user_id, "error": error_message}
            )
        logger.info(f"Logged error for user {user_id}")
    except Exception as e:
        logger.error(f"Error logging error for user {user_id}: {e}")

async def save_pet_stats(user_id: int, stats: Dict[str, int]) -> None:
    """Save pet stats to the server."""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{SERVER_URL}/Pet_stats",
                json={"user_id": user_id, "stats": stats}
            )
        logger.info(f"Saved stats for user {user_id}")
    except Exception as e:
        logger.error(f"Error saving stats for user {user_id}: {e}")




ROOMS = {
    "Bedroom": "🛌 You are in the Bedroom! 🛌",
    "Bathroom": "🚽 You are in the Bathroom! 🚽",
    "Kitchen": "🍽 You're in the Kitchen! 🍽",
    "Games": "🕹️ Welcome to the Game Room! 🕹️"
}

# ===========================
# STATUS AND STATS FUNCTIONS
# ===========================


def extract_stats(message: str) -> Dict[str, int]:
    """Extract pet stats from Telegram messages (handles bold formatting)."""
    stats = {
        'energy': 0,
        'clean': 0,
        'health': 0,
        'hunger': 0,
        'happiness': 0,
        'is_sleeping': False,
        'in_bedroom': False,
        'current_room': None
    }

    if not message:
        return stats

    # Detect current room
    room_identifiers = {
        "Bedroom": ["🛌** You are in the Bedroom!**", "It's time for a nap!"],
        "Bathroom": ["🚽** You are in the Bathroom!**", "🛁 Bath time!"],
        "Kitchen": ["🍽** You're in the Kitchen!**", "🍳 Scroll to find the desired food!"],
        "Games": ["🕹️** Welcome to the Game Room!**", "🎮 Ready for a game time?"]
    }

    for room_name, phrases in room_identifiers.items():
        if any(phrase in message for phrase in phrases):
            stats['current_room'] = room_name
            break

    # Detect sleep status
    stats['is_sleeping'] = any(
        phrase in message 
        for phrase in ["PettBro is sleeping 😴", "It's time for a nap!", "🌃 It's time for a nap!"]
    )
    stats['in_bedroom'] = stats['current_room'] == "Bedroom"

    # Extract stats patterns
    stat_patterns = [
        (r'🍗\s*\|\s*Hunger:\s*\*\*(\d+)\*\*', 'hunger'),
        (r'❤️\s*\|\s*Health:\s*\*\*(\d+)\*\*', 'health'),
        (r'🔋\s*\|\s*Energy:\s*\*\*(\d+)\*\*', 'energy'),
        (r'🙂\s*\|\s*Happiness:\s*\*\*(\d+)\*\*', 'happiness'),
        (r'🧼\s*\|\s*Clean:\s*\*\*(\d+)\*\*', 'clean'),
        (r'🍗\s*\*\*(\d+)\*\*', 'hunger'),
        (r'❤️\s*\*\*(\d+)\*\*', 'health'),
        (r'🔋\s*\*\*(\d+)\*\*', 'energy'),
        (r'🙂\s*\*\*(\d+)\*\*', 'happiness'),
        (r'🧼\s*\*\*(\d+)\*\*', 'clean')
    ]

    for pattern, stat_key in stat_patterns:
        match = re.search(pattern, message)
        if match:
            try:
                stats[stat_key] = int(match.group(1))
            except (ValueError, IndexError):
                continue

    return stats

# ===========================
# ACTION FUNCTIONS
# ===========================

async def click(client: TelegramClient, button_text: str, original_call: bool = True) -> bool:
    """Click a button by text (case-insensitive partial match) with fallback to home/start.
    
    Args:
        client: TelegramClient instance
        button_text: Text to match in buttons
        original_call: Flag to track if this is the first call (not a recursive fallback)
    """
    try:
        # Get the latest message
        messages = await client.get_messages(BOT_USERNAME, limit=1)
        if not messages:
            logger.warning("No messages found from bot")
            return False

        msg = messages[0]
        if not msg.reply_markup:
            logger.warning("Message has no buttons")
            return False

        # Extract and log all available buttons
        buttons = [btn.text for row in msg.reply_markup.rows for btn in row.buttons]
        logger.info(f"Available buttons: {', '.join(buttons)}")

        # Find matching button (case-insensitive partial match)
        target_button = next(
            (btn for btn in buttons if button_text.lower() in btn.lower()),
            None
        )

        if target_button:
            logger.info(f"Clicking button: {target_button}")
            await msg.click(text=target_button)
            await asyncio.sleep(1)
            return True
        
        # Only try fallbacks if this is the original call (not a recursive fallback)
        if original_call:
            # Try home button
            home_button = next((btn for btn in buttons if "🏠" in btn), None)
            if home_button:
                logger.info(f"Target button not found, clicking home button: {home_button}")
                await msg.click(text=home_button)
                await asyncio.sleep(1)
                # Try again after going home (but mark as not original call)
                return await click(client, button_text, original_call=False)
            
            # If no home button, try /start
            logger.info("Target button not found, sending /start command")
            await client.send_message(BOT_USERNAME, "/start")
            await asyncio.sleep(1)
            # Try again after /start (but mark as not original call)
            return await click(client, button_text, original_call=False)
        
        # If we're in a fallback call and still can't find it, give up
        logger.warning(f"Button matching '{button_text}' not found after fallbacks")
        return False

    except Exception as e:
        logger.error(f"Error in click: {str(e)}")
        return False

# ===========================
# ACTION FUNCTIONS (Updated)
# ===========================

#///////////Sleep and Wake ////////////////////

async def sleep_pet(client: TelegramClient) -> bool:
    """Put pet to sleep by clicking Bedroom then Sleep buttons, then return Home."""
    logger.info("😴 Starting sleep sequence")
    
    if not await click(client, "Bedroom"):
        logger.error("🚫 Failed to find Bedroom button")
        return False
    await asyncio.sleep(2)  # Wait after entering bedroom
    
    logger.info("🛏️ Found Bedroom - looking for Sleep button")
    if not await click(client, "sleep"):
        logger.error("🚫 Failed to find Sleep button")
        return False
    await asyncio.sleep(2)  # Wait after putting to sleep
    
    # Return home
    logger.info("🏠 Returning to Home after sleep")
    if not await click(client, "🏠"):
        logger.error("🚫 Failed to find Home button")
        return False
    
    logger.info("✅ Pet is now sleeping and back home")
    return True

#/////////_//////_Wake the Mf ___///////////////

async def wake_pet(client: TelegramClient) -> bool:
    """Wake pet by clicking Bedroom then Wake buttons, then return Home."""
    logger.info("⏰ Starting wake sequence")
    
    if not await click(client, "Bedroom"):
        logger.error("🚫 Failed to find Bedroom button")
        return False
    await asyncio.sleep(2)  # Wait after entering bedroom
    
    logger.info("🛏️ Found Bedroom - looking for Wake button")
    if not await click(client, "wake"):
        logger.error("🚫 Failed to find Wake button")
        return False
    await asyncio.sleep(2)  # Wait after waking up
    
    # Return home
    logger.info("🏠 Returning to Home after wake")
    if not await click(client, "🏠"):
        logger.error("🚫 Failed to find Home button")
        return False
    
    logger.info("✅ Pet is now awake and back home")
    return True

#////////////Sleep and Wake/////////////////////////////////

#////////////////////// Bathing Pet////////////////////////////

async def bathe_pet(client: TelegramClient) -> bool:
    """Bathe pet by clicking Bathroom, multiple Rubs, Shower, then return Home."""
    logger.info("🛁 Starting bath sequence")
    
    # Initial bathroom entry
    if not await click(client, "Bathroom"):
        logger.error("🚫 Failed to find Bathroom button")
        return False
    await asyncio.sleep(2)  # Wait after entering bathroom
    
    # Rub sequence
    logger.info("🚿 Found Bathroom - beginning rub sequence (5 rubs)")
    for i in range(1, 6):
        if not await click(client, "rub"):
            logger.error(f"🚫 Failed rub {i}/5")
            return False
            
        logger.info(f"🧽 Completed rub {i}/5")
        if i < 5:  # Don't wait after the last rub
            wait_time = random.uniform(2.0, 3.0)
            await asyncio.sleep(wait_time)
    
    # Shower
    logger.info("🧼 Looking for Shower button")
    await asyncio.sleep(2)  # Wait before shower
    if not await click(client, "shower"):
        logger.error("🚫 Failed to find Shower button")
        return False
    await asyncio.sleep(2)  # Wait after shower
    
    # Return home
    logger.info("🏠 Returning to Home")
    if not await click(client, "🏠"):  # Home button
        logger.error("🚫 Failed to find Home button")
        return False
    
    logger.info("✅ Pet is now clean and back home")
    return True

#/////////////////Ends////////////////////////////////


#➖➖➖➖➖➖ Ballgame ~~~~~~~~~~~~~~√••~~~~••~•~•

async def play_throw_ball_game(client: TelegramClient) -> bool:
    """Play throw ball game with full navigation flow:
    1. Games → Throw Ball
    2. For 3 attempts:
       a. Click Back (⬅️)
       b. Try Again
    3. Final back navigation to Game Room
    4. Return Home"""
    
    logger.info("🎾 Starting throw ball game sequence")
    
    # Enter Games section
    if not await click(client, "Games"):
        logger.error("🚫 Failed to find Games button")
        return False
    await asyncio.sleep(2)
    
    # Select Throw Ball game
    logger.info("🕹️ Found Games - looking for Throw button")
    if not await click(client, "throw"):
        logger.error("🚫 Failed to find Throw button")
        return False
    await asyncio.sleep(2)
    
    # Game attempts loop
    logger.info("🔁 Starting 3 game attempts")
    for attempt in range(1, 4):
        # Click back arrow before each attempt (including first)
        if not await click(client, "⬅️"):
            logger.error("🚫 Failed to find Back arrow")
            return False
        await asyncio.sleep(1)
        
        # Try Again
        if not await click(client, "try again"):
            logger.error(f"🚫 Failed Try Again {attempt}/3")
            return False
        logger.info(f"🔄 Completed attempt {attempt}/3")
        await asyncio.sleep(2)
    
    # Final back navigation
    logger.info("↩️ Final navigation to Game Room")
    if not await click(client, "⬅️"):
        logger.error("🚫 Failed to find Back arrow")
        return False
    await asyncio.sleep(1)
    
    if not await click(client, "Back to game Room"):
        logger.error("🚫 Failed to find Game Room button")
        return False
    await asyncio.sleep(1)
    
    # Return home
    logger.info("🏠 Returning to Home")
    if not await click(client, "🏠"):
        logger.error("🚫 Failed to find Home button")
        return False
    
    logger.info("✅ Game session completed and returned home")
    return True

#➖➖➖➖➖➖ Ballgame ~~~~~~~~~~~~~~√••~~~~••~•~•

PREFERRED_FOOD = os.getenv('PREFERRED_FOOD', '🍣 Sushi')
PREFERRED_AMOUNT = int(os.getenv('PREFERRED_AMOUNT', 1))
async def feed_pet(client: TelegramClient) -> bool:
    """Enhanced pet feeding with food purchasing capability:
    1. Check hunger level first
    2. Try to feed with available food
    3. If no food, purchase preferred food
    4. Feed until hunger > 60"""
    
    logger.info("🍽️ Starting feeding sequence")
    
    # First check pet stats
    messages = await client.get_messages(BOT_USERNAME, limit=1)
    if not messages:
        logger.error("No message received from bot")
        return False
    
    stats = extract_stats(messages[0].text)
    if not stats or stats.get('hunger') is None:
        logger.error("Could not determine hunger level")
        return False
        
    if stats['hunger'] > 60:
        logger.info(f"🐾 Pet hunger is {stats['hunger']} (already satisfied)")
        return True
    
    # Attempt to feed with existing food
    if await try_feeding(client):
        return True
    
    # If feeding failed, purchase food
    logger.info("🛒 No food available - starting purchase sequence")
    if not await purchase_food(client):
        logger.error("❌ Failed to purchase food")
        return False
    
    # Try feeding again after purchase
    return await try_feeding(client)

async def try_feeding(client: TelegramClient) -> bool:
    """Attempt to feed pet with available food"""
    logger.info("🍳 Attempting to feed pet")
    
    # Enter Kitchen
    if not await click(client, "Kitchen"):
        logger.error("🚫 Failed to find Kitchen button")
        return False
    await asyncio.sleep(2)
    
    # Get available food
    messages = await client.get_messages(BOT_USERNAME, limit=1)
    if not messages:
        logger.warning("No messages found from bot")
        return False

    msg = messages[0]
    if not msg.reply_markup:
        logger.warning("Message has no buttons")
        return False

    # Try all food options
    buttons = [btn.text for row in msg.reply_markup.rows for btn in row.buttons]
    logger.info(f"Available food: {', '.join(buttons)}")
    
    food_options = [
        '🍣 Sushi', '🥗 Salad', '🍪 Cookie', 
        '🍔 Burger', '🍕 Pizza', '🍎 Fruit'
    ]
    
    for food in food_options:
        if any(food in btn for btn in buttons):
            if await click(client, food):
                logger.info(f"🍗 Fed pet with {food}")
                await asyncio.sleep(3)
                
                # Back navigation
                await click(client, "⬅️")
                await asyncio.sleep(1)
                await click(client, "⬅️")
                await asyncio.sleep(1)
                
                # Return home
                await click(client, "🏠")
                logger.info("✅ Feeding successful")
                return True
    
    logger.warning("🚫 No food available")
    return False

async def purchase_food(client: TelegramClient) -> bool:
    """Purchase food from cafeteria"""
    logger.info("🛒 Starting food purchase sequence")
    
    # Navigate to Cafeteria
    if not await click(client, "Cafeteria 🏪"):
        logger.error("🚫 Failed to find Cafeteria button")
        return False
    await asyncio.sleep(2)
    
    # Select preferred food
    if not await click(client, PREFERRED_FOOD):
        logger.error(f"🚫 Failed to find {PREFERRED_FOOD}")
        return False
    await asyncio.sleep(1)
    
    # Adjust quantity
    for _ in range(PREFERRED_AMOUNT - 1):
        if not await click(client, "+"):
            logger.error("🚫 Failed to find + button")
            return False
        await asyncio.sleep(0.5)
    
    # Complete purchase
    if not await click(client, "Buy 💰"):
        logger.error("🚫 Failed to find Buy button")
        return False
    await asyncio.sleep(2)
    
    # Navigation back
    await click(client, "⬅️")
    await asyncio.sleep(1)
    await click(client, "⚪")
    await asyncio.sleep(1)
    await click(client, "⬆️")
    await asyncio.sleep(1)
    await click(client, "🏠")
    
    logger.info("🛍️ Food purchase completed")
    return True

async def get_pet_stats(client: TelegramClient) -> Dict[str, int]:
    """Get current pet stats"""
    messages = await client.get_messages(BOT_USERNAME, limit=1)
    if not messages:
        return default_stats()

async def emergency_care(client: TelegramClient) -> bool:
    """Emergency care procedure:
    1. Go to Kitchen
    2. Check for ♥️ potion
    3. If found, use it and return home
    4. If not found, go to Cafeteria to buy potion
    5. Use purchased potion and return home"""
    
    logger.info("🚨 Starting emergency care sequence")
    
    # Step 1: Go to Kitchen
    if not await click(client, "Kitchen"):
        logger.error("🚫 Failed to find Kitchen button")
        return False
    await asyncio.sleep(2)
    
    # Step 2: Check for existing potion
    if await use_existing_potion(client):
        return True
    
    # Step 3: Purchase new potion if none found
    logger.info("💊 No potion available - starting purchase sequence")
    if not await purchase_potion(client):
        logger.error("❌ Failed to purchase potion")
        return False
    
    # Step 4: Use the newly purchased potion
    return await use_existing_potion(client)

async def use_existing_potion(client: TelegramClient) -> bool:
    """Check for and use existing health potion"""
    logger.info("🔍 Checking for existing potion")
    
    # Get current buttons
    messages = await client.get_messages(BOT_USERNAME, limit=1)
    if not messages or not messages[0].reply_markup:
        logger.warning("No buttons found in kitchen")
        return False
    
    buttons = [btn.text for row in messages[0].reply_markup.rows for btn in row.buttons]
    
    # Check for potion button
    if "♥️ Potion" in buttons:
        logger.info("💉 Found potion - administering to pet")
        if await click(client, "♥️ Potion"):
            await asyncio.sleep(2)
            
            # Navigation back home
            await click(client, "⬅️")
            await asyncio.sleep(2)
            await click(client, "⬅️")
            await asyncio.sleep(1)
            await click(client, "🏠")
            logger.info("✅ Emergency care completed")
            return True
    
    logger.info("🚫 No potion found in kitchen")
    return False

async def purchase_potion(client: TelegramClient) -> bool:
    """Purchase health potion from cafeteria"""
    logger.info("🏥 Starting potion purchase sequence")
    
    # Navigate to Cafeteria
    if not await click(client, "Cafeteria"):
        logger.error("🚫 Failed to find Cafeteria button")
        return False
    await asyncio.sleep(2)
    
    # Select potion
    if not await click(client, "♥️ Potion (S)"):
        logger.error("🚫 Failed to find potion button")
        return False
    await asyncio.sleep(1)
    
    # Buy potion
    if not await click(client, "Buy"):
        logger.error("🚫 Failed to find Buy button")
        return False
    await asyncio.sleep(2)
    
    # Navigation back to kitchen
    await click(client, "⬅️")
    await asyncio.sleep(1)
    await click(client, "⚪")
    await asyncio.sleep(1)
    await click(client, "⬆️")
    await asyncio.sleep(1)
    
    logger.info("🛍️ Potion purchase completed")
    return True


async def auto_door(client: TelegramClient, user_id: int) -> None:
    """Automatically interact with doors every 2 hours:
    1. Games → Games → Doors
    2. Pick random door (Door 1/Door 2/Door 3)
    3. Click back (⬅️) twice with 2s delay
    4. Return home (🏠)"""
    
    logger.info(f"🚪 Starting automated Door sequence for user {user_id}")
    
    try:
        # First Games button
        if not await click(client, "Games"):
            logger.error("🚫 Failed to find first Games button i")
            return
        await asyncio.sleep(4)
        
        # Second Games button
        if not await click(client, "Games"):
            logger.error("🚫 Failed to find second Games button")
            return
        await asyncio.sleep(4)
        
        # Doors button
        if not await click(client, "Doors"):
            logger.error("🚫 Failed to find Doors button")
            return
        await asyncio.sleep(4)
        
        # Random door selection
        doors = ["Door 1", "Door 2", "Door 3"]
        selected_door = random.choice(doors)
        if not await click(client, selected_door):
            logger.error(f"🚫 Failed to find {selected_door}")
            return
        logger.info(f"🚪 Selected {selected_door}")
        await asyncio.sleep(4)
        
        # First back click
        if not await click(client, "⬅️"):
            logger.error("🚫 Failed first back navigation")
            return
        await asyncio.sleep(2)
        
        # Return home
        if not await click(client, "🏠"):
            logger.error("🚫 Failed to return home")
            return
        
        logger.info("✅ Automated Door sequence completed successfully")
        return True
        
    except Exception as e:
        logger.error(f"❌ Automated Door sequence failed: {str(e)}")
        # Attempt to return home if something went wrong
        await click(client, "🏠")
        return False
async def auto_wordle(client: TelegramClient, user_id: str) -> bool:
    """
    Automates the Wordle game process using httpx for server communication:
    1. Checks if Wordle is already done today
    2. Plays Wordle if attempts remain
    3. Handles both success and failure cases
    4. Updates server with results
    """
    logger.info("🎮 Starting Wordle automation")
    
    # Navigate to Wordle game
    if not await click(client, "Games 🎮"):
        logger.error("🚫 Failed to find Games button")
        return False
    await asyncio.sleep(4)
       # Navigate to Wordle game
    if not await click(client, "Games 🎮"):
        logger.error("🚫 Failed to find Games button")
        return False
    await asyncio.sleep(4)
    
    if not await click(client, "Wordle"):
        logger.error("🚫 Failed to find Wordle button")
        return False
    await asyncio.sleep(3)
    
    # Check current message
    messages = await client.get_messages(BOT_USERNAME, limit=1)
    if not messages:
        logger.warning("No messages found from bot")
        return False
    
    msg = messages[0]
    message_text = msg.text or ""
    
    # Check if already completed today
    if "You've used all your attempts for today" in message_text:
        logger.info("✅ Wordle already completed today")
        await click(client, "⬅️")
        await asyncio.sleep(1)
        await click(client, "⬅️")
        await asyncio.sleep(1)
        await click(client, "🏠")
        return True
   
    # Get today's Wordle from server
    try:
        async with httpx.AsyncClient(timeout=10) as http_client:
            response = await http_client.post(
                f"{SERVER_URL}/checkWordle",
                json={'userId': user_id},
                headers={"Content-Type": "application/json"}
            )
            response.raise_for_status()
            data = response.json()
            
            if data.get('exists') and data['wordle']:
                wordle = data['wordle']['wordle']
                logger.info(f"🔍 Found existing Wordle: {wordle}")
            else:
                logger.info("🔍 No existing Wordle found")
                return False
    except httpx.TimeoutException:
        logger.error("⌛ Timeout while checking Wordle on server")
        return False
    except Exception as e:
        logger.error(f"🚫 Server error checking Wordle: {str(e)}")
        return False
    
    # Send the Wordle answer
    await client.send_message(BOT_USERNAME, wordle)
    logger.info(f"📩 Sent Wordle: {wordle}")
    await asyncio.sleep(6)  # Wait for response
    
    # Check result
    messages = await client.get_messages(BOT_USERNAME, limit=1)
    if not messages:
        logger.warning("No response after sending Wordle")
        return False
    
    msg = messages[0]
    message_text = msg.text or ""
    
    # Handle success case
    if "🎉 You guessed the word!" in message_text:
        logger.info("🎉 Wordle solved successfully!")
        await click(client, "🏠")
        
        # Extract the word from message
        word = None
        for line in message_text.split('\n'):
            if line.startswith('The word was:'):
                word = line.split(':')[-1].strip()
                break
        
        # Verify on server
        try:
            async with httpx.AsyncClient(timeout=10) as http_client:
                response = await http_client.post(
                    f"{SERVER_URL}/saveWordle",
                    json={
                        'userId': user_id,
                        'wordle': word,
                        'status': 'Verified'
                    },
                    headers={"Content-Type": "application/json"}
                )
                response.raise_for_status()
                data = response.json()
                
                if data.get('success'):
                    logger.info("✅ Successfully verified Wordle on server")
                    return True
                logger.error("🚫 Failed to verify Wordle on server")
                return False
        except httpx.TimeoutException:
            logger.error("⌛ Timeout while verifying Wordle on server")
            return False
        except Exception as e:
            logger.error(f"🚫 Server error verifying Wordle: {str(e)}")
            return False
    
    # Handle wrong guess case
    elif "You have" in message_text and "tries left" in message_text:
        logger.info("❌ Wrong Wordle guess")
        await click(client, "🏠")
        
        # Mark as wrong on server
        try:
            async with httpx.AsyncClient(timeout=10) as http_client:
                response = await http_client.post(
                    f"{SERVER_URL}/saveWordle",
                    json={
                        'userId': user_id,
                        'wordle': wordle,
                        'status': 'Wrong'
                    },
                    headers={"Content-Type": "application/json"}
                )
                response.raise_for_status()
                data = response.json()
                
                if data.get('success'):
                    logger.info("✅ Successfully saved Wrong Wordle on server")
                    return True
                logger.error("🚫 Failed to save Wrong Wordle on server")
                return False
        except httpx.TimeoutException:
            logger.error("⌛ Timeout while saving Wrong Wordle on server")
            return False
        except Exception as e:
            logger.error(f"🚫 Server error saving Wrong Wordle: {str(e)}")
            return False
    
    # Unknown response
    logger.error(f"🚫 Unknown Wordle response: {message_text}")
    return False


# ----------------------------
# AI-Enhanced Main Monitoring Function
# ----------------------------
# ----------------------------
# AI-Enhanced Main Monitoring Function
# ----------------------------
async def get_current_status(client: TelegramClient) -> Tuple[Optional[str], Optional[str]]:
    """Get current pet status for single client with robust error handling."""
    try:
        # Try to get the last message first
        messages = await client.get_messages(BOT_USERNAME, limit=1)
        if messages and messages[0].text:
            msg_text = messages[0].text
            if any(keyword in msg_text for keyword in STATUS_KEYWORDS):
                return msg_text, messages[0].reply_markup

        # If no valid message found, request fresh status
        async with client.conversation(BOT_USERNAME, timeout=15) as conv:
            try:
                await conv.send_message('/start')
                response = await conv.get_response()
                
                # Verify we got a proper response
                if response and response.text:
                    return response.text, response.reply_markup
                
            except asyncio.TimeoutError:
                logger.warning("Timeout waiting for bot response")
            except Exception as conv_error:
                logger.warning(f"Conversation error: {str(conv_error)}")

        # Final fallback attempt
        messages = await client.get_messages(BOT_USERNAME, limit=1)
        if messages and messages[0].text:
            return messages[0].text, messages[0].reply_markup

    except Exception as e:
        logger.error(f"Status check failed: {str(e)}")
        # Reset conversation state if exists
        if hasattr(client, '_conversation'):
            client._conversation = None

    return None, None

# Constants (put at top of file)
STATUS_KEYWORDS = [
    "Energy:", "Hunger:", "Health:", 
    "Happiness:", "Clean:", "Sleeping:",
    "You are in the", "Current room:"
]

# ----------------------------
# AI-Enhanced Main Monitoring Function (Single User)
# ----------------------------
async def monitor_pet(session_string: str, client: TelegramClient) -> None:
    """AI-enhanced function to monitor and care for a single pet, with Wordle and Door automation."""
    try:
        await client.start()
        me = await client.get_me()
        user_id = me.id
        logger.info(f"🐾 Pet monitoring session started for user {user_id}")

        start_time = time.time()
        max_duration = 180 * 60  # 3 hours runtime
        consecutive_errors = 0

        # Initialize timers for Wordle and Door automation
        last_wordle_time = 0
        last_door_time = 0
        wordle_interval = 30 * 60  # 2 hours
        door_interval = 30 * 60    # 2 hours

        while time.time() - start_time < max_duration:
            try:
                logger.info("\n🤖 AI Checking pet status...")
                message, _ = await get_current_status(client)

                if not message:
                    logger.warning("No message received from bot")
                    consecutive_errors += 1
                    await log_pet_error(user_id, "No message received from bot")

                    if consecutive_errors >= 3:
                        logger.error("Too many consecutive errors, restarting client")
                        await client.disconnect()
                        await asyncio.sleep(5)
                        await client.connect()
                        consecutive_errors = 0
                    await asyncio.sleep(30)
                    continue

                consecutive_errors = 0
                stats = extract_stats(message)
                await save_pet_stats(user_id, stats)

                logger.info(f"📊 Current Status:\nEnergy: {stats['energy']} | Clean: {stats['clean']}\n"
                            f"Health: {stats['health']} | Hunger: {stats['hunger']}\n"
                            f"Happiness: {stats['happiness']} | Sleeping: {stats['is_sleeping']}")

                # AI decision for pet care
                try:
                    ai_decision = await asyncio.wait_for(
                        get_ai_decision(stats, user_id),
                        timeout=20
                    )
                except asyncio.TimeoutError:
                    logger.warning("AI decision timeout, using default action")
                    await log_pet_error(user_id, "AI decision timeout")
                    ai_decision = {'action': 'wait', 'priority': 'medium'}

                action_handlers = {
                    'emergency': (emergency_care, "🚨 Emergency care"),
                    'wake': (wake_pet, "☀️ Waking pet"),
                    'play': (play_throw_ball_game, "🎮 Playing game"),
                    'feed': (feed_pet, "🍽️ Feeding"),
                    'bathe': (bathe_pet, "🛁 Bathing"),
                    'sleep': (sleep_pet, "😴 Putting to sleep")
                }

                if ai_decision['action'] in action_handlers:
                    handler, action_name = action_handlers[ai_decision['action']]
                    logger.info(f"{action_name} | Reason: {ai_decision.get('reasoning', 'N/A')}")
                    try:
                        await handler(client)
                    except Exception as e:
                        logger.error(f"Action failed: {str(e)}")
                        await log_pet_error(user_id, f"Action failed: {str(e)}")

                # ----------------------------
                # Automated Wordle (every 2 hours)
                # ----------------------------
                if time.time() - last_wordle_time > wordle_interval:
                    logger.info("🎮 Running automated Wordle...")
                    try:
                        await auto_wordle(client, user_id)
                        last_wordle_time = time.time()
                    except Exception as e:
                        logger.error(f"Wordle automation failed: {str(e)}")
                        await log_pet_error(user_id, f"Wordle automation failed: {str(e)}")

                # ----------------------------
                # Automated Doors (every 2 hours)
                # ----------------------------
                if time.time() - last_door_time > door_interval:
                    logger.info("🚪 Running automated Door sequence...")
                    try:
                        await auto_door(client, user_id)
                        last_door_time = time.time()
                    except Exception as e:
                        logger.error(f"Door automation failed: {str(e)}")
                        await log_pet_error(user_id, f"Door automation failed: {str(e)}")

                # Adaptive sleep based on AI priority
                sleep_time = 20 if ai_decision.get('priority') == 'high' else 30
                logger.info(f"⏳ Next check in {sleep_time} seconds")
                await asyncio.sleep(sleep_time)

            except Exception as e:
                logger.error(f"Monitoring error: {str(e)}")
                await log_pet_error(user_id, f"Monitoring error: {str(e)}")
                await asyncio.sleep(min(60, 10 * (consecutive_errors + 1)))
                consecutive_errors += 1

    except Exception as e:
        logger.error(f"💥 Critical monitoring failure: {str(e)}")
        await log_pet_error(user_id, f"Critical monitoring failure: {str(e)}")
    finally:
        await safe_client_disconnect(client)
        logger.info("🛑 Monitoring session ended")
# ----------------------------
# Flask Thread Setup
# ----------------------------
def run_flask():
    port = int(os.getenv('PORT', 5005))  # default 5005 if not set in .env
    app.run(host='0.0.0.0', port=port)

def start_flask_in_thread():
    flask_thread = threading.Thread(target=run_flask)
    flask_thread.daemon = True
    flask_thread.start()

# ----------------------------
# Main Program (Single User)
# ----------------------------
# ----------------------------
# Main Program (Multi-User, Parallel)
# ----------------------------
# ----------------------------
# Fetch sessions from server
# ----------------------------
def fetch_sessions_from_db():
    try:
        resp = requests.get(SERVER_URL, timeout=10)
        resp.raise_for_status()
        data = resp.json()

        # Each record: { id, session, userId, chatId, ... }
        sessions = {}
        for item in data:
            if "session" in item and "userId" in item:
                sessions[item["userId"]] = item["session"]
        return dict(list(sessions.items())[:10])  # limit max 10
    except Exception as e:
        logger.error(f"❌ Failed to fetch sessions from DB: {str(e)}")
        return {}

# ----------------------------
# Manage monitoring pool
# ----------------------------
async def manage_sessions():
    """Periodically refresh sessions from DB and sync monitoring tasks."""
    global active_tasks

    while True:
        logger.info("🔄 Refreshing sessions from DB...")
        sessions = fetch_sessions_from_db()

        # Stop tasks for users no longer in DB
        for user_id in list(active_tasks.keys()):
            if user_id not in sessions:
                logger.info(f"🛑 Stopping monitoring for user {user_id} (removed from DB)")
                active_tasks[user_id].cancel()
                del active_tasks[user_id]

        # Start tasks for new users
        for user_id, session in sessions.items():
            if user_id not in active_tasks:
                try:
                    client = TelegramClient(StringSession(session), API_ID, API_HASH)
                    task = asyncio.create_task(monitor_pet(session, client))
                    active_tasks[user_id] = task
                    logger.info(f"🐾 Started monitoring for new user {user_id}")
                except Exception as e:
                    logger.error(f"💥 Failed to start session for user {user_id}: {str(e)}")

        # Keep max 10
        if len(active_tasks) > 10:
            logger.warning("⚠️ Too many tasks, trimming to 10 users")
            for user_id in list(active_tasks.keys())[10:]:
                active_tasks[user_id].cancel()
                del active_tasks[user_id]

        await asyncio.sleep(300)  # refresh every 5 minutes

# ----------------------------
# Main Runner
# ----------------------------
async def main() -> None:
    start_flask_in_thread()

    # Start the session manager loop
    await manage_sessions()

def run_async_code():
    while True:
        try:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            loop.run_until_complete(main())
        except Exception as e:
            logger.error(f"Fatal error in event loop: {str(e)}")
            time.sleep(30)
        finally:
            if 'loop' in locals():
                loop.close()

if __name__ == '__main__':
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    run_async_code()