# White-Label Chat System

A professional, production-ready chat system with multi-agent support, AI auto-response, and WhatsApp-style features.

## Features

✅ **Multi-Agent System** - Multiple agents can handle different customer sessions
✅ **AI Auto-Response** - Keyword-based AI responses until human agent takes over
✅ **WhatsApp-Style Read Receipts** - Single/double check marks for message status
✅ **Real-time WebSocket Communication** - Instant message delivery
✅ **Customer Form Capture** - Collect customer information during chat
✅ **Session Management** - Track and assign customer sessions to agents
✅ **Rate Limiting & Security** - Prevent spam and abuse
✅ **Block List Management** - Block abusive users by session/device/IP
✅ **Typing Indicators** - See when agents or customers are typing
✅ **Online Status** - See when agents are available

## Architecture

- **Backend**: Node.js + Express + WebSocket (WS)
- **Database**: PostgreSQL
- **Authentication**: JWT tokens for agents
- **Security**: Rate limiting, IP tracking, device fingerprinting

## Installation

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables in `.env`:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chat_system_db
DB_USER=your_username
DB_PASSWORD=your_password

PORT=5003
WS_PORT=5004
```

3. Create database and tables:
```sql
-- See database schema in docs/schema.sql
```

4. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## API Endpoints

### Chat
- `GET /api/chat/device` - Get or create device ID
- `POST /api/contact` - Submit a message
- `GET /api/contact/messages` - Get all messages (Admin)
- `GET /api/contact/user-messages/:sessionId` - Get user's messages
- `POST /api/contact/reply` - Reply to a message (Agent)

### Agents
- `POST /api/agent/login` - Agent authentication
- `GET /api/agents` - List all agents
- `POST /api/agent/create` - Create new agent
- `DELETE /api/agent/:agentId` - Delete agent
- `POST /api/agent/assign` - Assign session to agent
- `POST /api/agent/release` - Release session from agent

### Customers
- `POST /api/chat/customer` - Create/update customer
- `GET /api/chat/customer/:sessionId` - Get customer by session
- `GET /api/chat/customers` - List all customers
- `GET /api/chat/customers/search` - Search customers
- `POST /api/chat/customer/:customerId/flag` - Flag customer as scam

### Security
- `POST /api/chat/security-log` - Log security event (rate limiting)
- `POST /api/chat/block` - Block a user
- `DELETE /api/chat/block/:sessionId` - Unblock a user
- `GET /api/chat/blocklist` - Get block list

### Health
- `GET /health` - Health check endpoint

## WebSocket Events

### Client → Server
- `register` - Register client (user or agent)
- `user_message` - Send message from user
- `admin_reply` - Send reply from agent
- `typing` - Typing indicator
- `mark_all_read` - Mark messages as read
- `agent_claim_session` - Agent claims a session
- `agent_status_change` - Update agent status

### Server → Client
- `admin_message` - Message from agent/AI
- `new_user_message` - New message from user (to agents)
- `admin_online` - Agent online status
- `admin_typing` - Agent is typing
- `message_status_update` - Message delivery status
- `all_messages_read` - All messages marked as read
- `session_assigned` - Session assigned to agent

## Database Schema

```sql
-- Agents table
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'support',
    created_at TIMESTAMP DEFAULT NOW()
);

-- Contact messages
CREATE TABLE contact_messages (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'new',
    project TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Contact replies
CREATE TABLE contact_replies (
    id SERIAL PRIMARY KEY,
    message_id INTEGER REFERENCES contact_messages(id),
    reply_text TEXT NOT NULL,
    admin_name TEXT NOT NULL,
    agent_id TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Chat customers
CREATE TABLE chat_customers (
    customer_id SERIAL PRIMARY KEY,
    session_id TEXT UNIQUE NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    is_scam BOOLEAN DEFAULT false,
    scam_reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Blocklist
CREATE TABLE chat_blocklist (
    id SERIAL PRIMARY KEY,
    session_id TEXT UNIQUE,
    device_id TEXT,
    ip_address TEXT,
    reason TEXT,
    blocked_until TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Configuration

### Rate Limits
Edit `RATE_LIMITS` in `chat-server.js`:
```javascript
const RATE_LIMITS = {
  MAX_SESSIONS_PER_HOUR: 3,
  MAX_MESSAGES_PER_MINUTE: 5,
  MAX_MESSAGES_PER_HOUR: 20
};
```

### AI Response Keywords
Edit `AI_RESPONSES` in `chat-server.js` to customize AI auto-responses.

## Production Deployment

1. Set `NODE_ENV=production` in `.env`
2. Change JWT secrets in `.env`
3. Use a proper PostgreSQL database (not localhost)
4. Use Redis for rate limiting (optional)
5. Use a reverse proxy (nginx) for SSL/TLS
6. Use PM2 or similar for process management

## License

MIT
