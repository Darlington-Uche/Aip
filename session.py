import asyncio
from telethon import TelegramClient
from telethon.sessions import StringSession
from flask import Flask, request, jsonify
from datetime import datetime
import time

app = Flask(__name__)
app.start_time = time.time()

# ... rest of your code ...
api_id = 24437159
api_hash = "e042a17a77502674470b0eadf0fdd0d7"
sessions = {}

# Create one global event loop for the app
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)

async def send_code_async(phone):
    client = TelegramClient(StringSession(), api_id, api_hash)
    await client.connect()
    await client.send_code_request(phone)
    sessions[phone] = client

async def create_session_async(phone, code):
    client = sessions.get(phone)
    if not client:
        raise Exception('No session found for this phone')
    await client.sign_in(phone, code)
    session_str = client.session.save()
    await client.disconnect()
    del sessions[phone]
    return session_str

def run_async(coro):
    return loop.run_until_complete(coro)

@app.route('/send_code', methods=['POST'])
def send_code():
    data = request.json
    phone = data.get('phone')

    if not phone:
        return jsonify({'error': 'Phone number required'}), 400

    try:
        run_async(send_code_async(phone))
        return jsonify({'message': 'Code sent successfully'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/create_session', methods=['POST'])
def create_session():
    data = request.json
    phone = data.get('phone')
    code = data.get('code')

    if not phone or not code:
        return jsonify({'error': 'Phone and code are required'}), 400

    try:
        session_str = run_async(create_session_async(phone, code))
        return jsonify({'session': session_str})
    except Exception as e:
        print(f"Create session error: {e}")
        return jsonify({'error': str(e)}), 500
# Health check endpoint
@app.route('/health')
def health_check():
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.utcnow().isoformat(),
        'uptime': time.time() - app.start_time
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)