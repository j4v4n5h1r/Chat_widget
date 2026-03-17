// White-Label Chat System API
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const crypto = require("crypto");
const http = require("http");
const WebSocket = require("ws");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const cookieParser = require("cookie-parser");

// CORS with credentials for cookies - Allow all origins for file uploads
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      // Allow all localhost ports
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        return callback(null, true);
      }

      // Allow production domains
      const allowedDomains = [
        "http://51.75.18.9",
        "http://indiantvstore.chat",
        "https://indiantvstore.chat",
        "http://www.indiantvstore.chat",
        "https://www.indiantvstore.chat",
      ];

      if (allowedDomains.includes(origin)) {
        return callback(null, true);
      }

      return callback(null, true); // Allow all for now (можно закрыть в production)
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());

// Serve uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Allow images, videos, and documents
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|mov|avi|pdf|doc|docx|txt/;
    const extname = allowedTypes.test(
      path.extname(file.originalname).toLowerCase(),
    );
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only images, videos, and documents are allowed.",
        ),
      );
    }
  },
});

const PORT = 5003;
const WS_PORT = 5004;

// Rate limiting storage (in-memory, use Redis in production)
const rateLimits = {
  sessions: new Map(), // deviceId -> { count, resetTime }
  messages: new Map(), // deviceId -> { count, resetTime, hourCount, hourResetTime }
};

// IP-based session tracking - MULTIPLE SESSIONS ALLOWED
// Allows multiple users from same IP (office/home) to chat simultaneously
const ipSessions = new Map(); // ip -> [{ sessionId, createdAt }]

// Check if IP already has an active session (now allows multiple)
const checkIPSession = (ip, sessionId) => {
  // ALWAYS ALLOW - no IP restriction
  // This enables multiple concurrent chats from same IP address
  return { allowed: true };
};

// Register IP session (now tracks multiple sessions per IP)
const registerIPSession = (ip, sessionId) => {
  if (!ipSessions.has(ip)) {
    ipSessions.set(ip, []);
  }
  const sessions = ipSessions.get(ip);
  // Add if not already exists
  if (!sessions.find((s) => s.sessionId === sessionId)) {
    sessions.push({ sessionId, createdAt: Date.now() });
  }
};

// Clear IP session when user disconnects
const clearIPSession = (ip, sessionId) => {
  const sessions = ipSessions.get(ip);
  if (sessions) {
    const filtered = sessions.filter((s) => s.sessionId !== sessionId);
    if (filtered.length > 0) {
      ipSessions.set(ip, filtered);
    } else {
      ipSessions.delete(ip);
    }
  }
};

// ==================== MULTI-AGENT SYSTEM ====================
// Store active agents: agentId -> { ws, name, status, assignedSessions: Set }
const activeAgents = new Map();

// Store session assignments: sessionId -> agentId (which agent is handling this session)
const sessionAssignments = new Map();

// Get agent by credentials from database
const authenticateAgent = async (username, password) => {
  try {
    const result = await pool.query(
      "SELECT * FROM agents WHERE username = $1",
      [username],
    );

    if (result.rows.length === 0) {
      return null;
    }

    const agent = result.rows[0];

    // Verify password with bcrypt
    const isValid = await bcrypt.compare(password, agent.password_hash);

    if (isValid) {
      return {
        id: agent.id,
        username: agent.username,
        name: agent.name,
        email: agent.email,
        role: agent.role,
      };
    }

    return null;
  } catch (error) {
    console.error("Error authenticating agent:", error);
    return null;
  }
};

// Assign session to agent
const assignSessionToAgent = (sessionId, agentId) => {
  // Remove from previous agent if any
  const previousAgentId = sessionAssignments.get(sessionId);
  if (previousAgentId && activeAgents.has(previousAgentId)) {
    const prevAgent = activeAgents.get(previousAgentId);
    prevAgent.assignedSessions.delete(sessionId);
  }

  // Assign to new agent
  sessionAssignments.set(sessionId, agentId);
  if (activeAgents.has(agentId)) {
    activeAgents.get(agentId).assignedSessions.add(sessionId);
  }

  // Notify all agents about assignment change
  broadcastToAgents({
    type: "session_assigned",
    sessionId,
    agentId,
    agentName: activeAgents.get(agentId)?.name || "Unknown",
  });
};

// Broadcast message to all active agents (optionally exclude one agent)
const broadcastToAgents = (message, excludeAgentId) => {
  activeAgents.forEach((agent, agentId) => {
    if (excludeAgentId && agentId === excludeAgentId) return;
    if (agent.ws && agent.ws.readyState === WebSocket.OPEN) {
      agent.ws.send(JSON.stringify(message));
    }
  });
};

// Get list of online agents
const getOnlineAgents = () => {
  const agents = [];
  activeAgents.forEach((agent, id) => {
    agents.push({
      id,
      name: agent.name,
      status: agent.status,
      assignedCount: agent.assignedSessions.size,
    });
  });
  return agents;
};

// Rate limit config
const RATE_LIMITS = {
  MAX_SESSIONS_PER_HOUR: 10,
  MAX_MESSAGES_PER_MINUTE: 30,
  MAX_MESSAGES_PER_HOUR: 200,
};

// Check rate limits
const checkRateLimit = (deviceId, type) => {
  const now = Date.now();

  if (type === "session") {
    const limit = rateLimits.sessions.get(deviceId) || {
      count: 0,
      resetTime: now + 3600000,
    };
    if (now > limit.resetTime) {
      limit.count = 0;
      limit.resetTime = now + 3600000;
    }
    if (limit.count >= RATE_LIMITS.MAX_SESSIONS_PER_HOUR) {
      return {
        allowed: false,
        reason: "Too many sessions. Please try again later.",
      };
    }
    limit.count++;
    rateLimits.sessions.set(deviceId, limit);
    return { allowed: true };
  }

  if (type === "message") {
    const limit = rateLimits.messages.get(deviceId) || {
      count: 0,
      resetTime: now + 60000,
      hourCount: 0,
      hourResetTime: now + 3600000,
    };

    // Reset minute counter
    if (now > limit.resetTime) {
      limit.count = 0;
      limit.resetTime = now + 60000;
    }

    // Reset hour counter
    if (now > limit.hourResetTime) {
      limit.hourCount = 0;
      limit.hourResetTime = now + 3600000;
    }

    if (limit.count >= RATE_LIMITS.MAX_MESSAGES_PER_MINUTE) {
      return {
        allowed: false,
        reason: "Too many messages. Please wait a moment.",
      };
    }
    if (limit.hourCount >= RATE_LIMITS.MAX_MESSAGES_PER_HOUR) {
      return {
        allowed: false,
        reason: "Message limit reached. Please try again later.",
      };
    }

    limit.count++;
    limit.hourCount++;
    rateLimits.messages.set(deviceId, limit);
    return { allowed: true };
  }

  return { allowed: true };
};

// ==================== AI AUTO-RESPONSE SYSTEM ====================

// AI toggle - admin can enable/disable via admin panel (default: OFF)
let aiEnabled = false;

// Track which sessions want human support
const humanSupportRequests = new Set();

// Keywords that trigger human support request
const HUMAN_SUPPORT_KEYWORDS = [
  "human",
  "real person",
  "agent",
  "operator",
  "representative",
  "gerçek insan",
  "gerçek kişi",
  "destek",
  "müşteri temsilcisi",
  "insan",
  "canlı destek",
  "temsilci",
  "yetkili",
  "talk to human",
  "speak to agent",
  "real support",
];

// AI Response templates based on keywords
const AI_RESPONSES = {
  greeting: {
    keywords: [
      "hello",
      "hi",
      "hey",
      "salam",
      "merhaba",
      "good morning",
      "good afternoon",
      "good evening",
    ],
    responses: [
      "Hello! How can I help you today?",
      "Hi there! How can I assist you?",
      "Welcome! How may I help you today?",
    ],
  },
  pricing: {
    keywords: [
      "price",
      "cost",
      "pricing",
      "how much",
      "fee",
      "qiymət",
      "fiyat",
      "ücret",
      "ne kadar",
    ],
    responses: [
      "For pricing information, please visit our pricing page or let me know which specific service you're interested in. I can provide detailed pricing information.",
      "Our pricing varies based on the service. Could you tell me which product or service you're asking about?",
    ],
  },
  hours: {
    keywords: [
      "hours",
      "open",
      "available",
      "when",
      "working hours",
      "saat",
      "açık",
      "çalışma saatleri",
    ],
    responses: [
      "Our support team is available 24/7! For complex issues, our agents are available during business hours (9 AM - 6 PM).",
      "We're available 24/7 to help you!",
    ],
  },
  help: {
    keywords: [
      "help",
      "support",
      "assist",
      "problem",
      "issue",
      "yardım",
      "sorun",
      "problem",
    ],
    responses: [
      "I'd be happy to help! Please describe your issue and I'll do my best to assist you.",
      "Sure, I'm here to help! What seems to be the problem? Let me know the details.",
    ],
  },
  thanks: {
    keywords: ["thank", "thanks", "teşekkür", "sağol", "appreciated"],
    responses: [
      "You're welcome! Is there anything else I can help you with?",
      "Happy to help! Let me know if you need anything else.",
      "Anytime! Feel free to ask if you have more questions.",
    ],
  },
  bye: {
    keywords: ["bye", "goodbye", "see you", "later", "görüşürük", "hoşça kal"],
    responses: [
      "Goodbye! Have a great day! Feel free to come back anytime.",
      "Take care! Don't hesitate to reach out if you need help again.",
    ],
  },
  default: {
    responses: [
      "Thank you for your message. Could you please provide more details about what you need?",
      "I understand. Let me help you with that. Can you tell me more about what you're looking for?",
      "Thanks for reaching out! What specific information do you need?",
    ],
  },
};

// Check if message requests human support
function wantsHumanSupport(message) {
  const lowerMessage = message.toLowerCase();
  return HUMAN_SUPPORT_KEYWORDS.some((keyword) =>
    lowerMessage.includes(keyword.toLowerCase()),
  );
}

// Generate AI response based on message content
function generateAIResponse(message, sessionId) {
  const lowerMessage = message.toLowerCase();

  // Check if user wants human support
  if (wantsHumanSupport(message)) {
    humanSupportRequests.add(sessionId);
    return {
      text: "Of course! I'm connecting you with an available agent now. Someone will be with you shortly. In the meantime, feel free to describe your issue.",
      isHumanRequest: true,
    };
  }

  // Find matching response category
  for (const [category, data] of Object.entries(AI_RESPONSES)) {
    if (category === "default") continue;

    if (
      data.keywords.some((keyword) =>
        lowerMessage.includes(keyword.toLowerCase()),
      )
    ) {
      const randomResponse =
        data.responses[Math.floor(Math.random() * data.responses.length)];
      return { text: randomResponse, isHumanRequest: false };
    }
  }

  // Default response
  const defaultResponses = AI_RESPONSES.default.responses;
  return {
    text: defaultResponses[Math.floor(Math.random() * defaultResponses.length)],
    isHumanRequest: false,
  };
}

// Check if session needs human support
function needsHumanSupport(sessionId) {
  return humanSupportRequests.has(sessionId);
}

// Create HTTP server for WebSocket
const server = http.createServer(app);
const wss = new WebSocket.Server({ port: WS_PORT });

// Store connected clients by session ID
const chatClients = new Map(); // sessionId -> { ws, type: 'user' | 'admin', currentPage, isTyping }

// Message status tracking: sent -> delivered -> read
const messageStatuses = new Map(); // messageId -> { status: 'sent' | 'delivered' | 'read', timestamp }

// WebSocket connection handling
wss.on("connection", (ws, req) => {
  let clientSessionId = null;
  let clientType = null;
  let currentPage = "Bilinmir";
  // Get client IP from WebSocket connection
  const clientIP =
    req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);

      // Client registration
      if (data.type === "register") {
        clientSessionId = data.sessionId;
        clientType = data.clientType;
        currentPage = data.project || data.currentPage || "Bilinmir";
        chatClients.set(clientSessionId, {
          ws,
          type: clientType,
          project: currentPage,
          ip: clientIP,
        });
        console.log(
          `📱 Chat client registered: ${clientType} (${clientSessionId}) on ${currentPage} from ${clientIP}`,
        );

        // Register IP-session mapping for users
        if (clientType === "user") {
          registerIPSession(clientIP, clientSessionId);
        }

        // Confirm registration
        ws.send(
          JSON.stringify({ type: "registered", sessionId: clientSessionId }),
        );

        // Notify user if there are online agents
        if (clientType === "user") {
          const hasOnlineAgents = activeAgents.size > 0;
          ws.send(
            JSON.stringify({
              type: "admin_online",
              online: hasOnlineAgents,
            }),
          );
        }

        // Notify all agents about new user
        if (clientType === "user") {
          // Get customer info if available
          const customerResult = await pool.query(
            "SELECT full_name FROM chat_customers WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1",
            [clientSessionId],
          );
          const customerName = customerResult.rows[0]?.full_name || null;

          // Notify all active agents
          broadcastToAgents({
            type: "new_user_connected",
            sessionId: clientSessionId,
            project: currentPage,
            isOnline: true,
            customerName: customerName,
            assignedTo: sessionAssignments.get(clientSessionId) || null,
          });
        }
      }

      // Agent registration (new multi-agent system)
      if (data.type === "agent_register") {
        const { agentId, agentName, token } = data;

        try {
          // Verify token
          const decoded = jwt.verify(token, "agent-secret-key");
          if (decoded.agentId !== agentId) {
            ws.send(
              JSON.stringify({ type: "error", message: "Invalid token" }),
            );
            return;
          }

          // Register agent
          activeAgents.set(agentId, {
            ws,
            name: agentName || decoded.name,
            status: "online",
            assignedSessions: new Set(),
            role: decoded.role,
          });

          clientSessionId = agentId;
          clientType = "agent";

          console.log(`👤 Agent registered: ${agentName} (${agentId})`);

          // Confirm registration
          ws.send(
            JSON.stringify({
              type: "agent_registered",
              agentId,
              agentName: agentName || decoded.name,
            }),
          );

          // Send current online agents list to all agents
          broadcastToAgents({
            type: "agents_list_updated",
            agents: getOnlineAgents(),
          });

          // Notify all users that an agent is now online
          chatClients.forEach((client) => {
            if (
              client.type === "user" &&
              client.ws.readyState === WebSocket.OPEN
            ) {
              client.ws.send(
                JSON.stringify({
                  type: "admin_online",
                  online: true,
                }),
              );
            }
          });

          // Send ALL sessions to agent (both active and historical)
          const allSessions = [];

          // First, get all unique session IDs from database
          try {
            const dbSessionsResult = await pool.query(`
              SELECT DISTINCT cm.session_id,
                     MAX(cm.created_at) as last_activity,
                     (SELECT full_name FROM chat_customers WHERE session_id = cm.session_id ORDER BY created_at DESC LIMIT 1) as customer_name,
                     (SELECT phone FROM chat_customers WHERE session_id = cm.session_id ORDER BY created_at DESC LIMIT 1) as customer_phone,
                     COUNT(cm.id) as message_count
              FROM contact_messages cm
              WHERE cm.session_id IS NOT NULL
              GROUP BY cm.session_id
              ORDER BY last_activity DESC
            `);

            // Build sessions list
            const sessionsMap = new Map();

            // Add all database sessions
            dbSessionsResult.rows.forEach((row) => {
              const sessionId = row.session_id;
              const activeClient = chatClients.get(sessionId);

              sessionsMap.set(sessionId, {
                sessionId,
                project: activeClient?.project || "Unknown",
                isOnline: activeClient
                  ? activeClient.ws.readyState === WebSocket.OPEN
                  : false,
                customerName: row.customer_name || null,
                customerPhone: row.customer_phone || null,
                messageCount: parseInt(row.message_count) || 0,
                lastActivity: row.last_activity,
              });
            });

            // Add currently active sessions that might not be in DB yet
            for (const [sessionId, client] of chatClients.entries()) {
              if (client.type === "user" && !sessionsMap.has(sessionId)) {
                try {
                  const customerResult = await pool.query(
                    "SELECT full_name FROM chat_customers WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1",
                    [sessionId],
                  );
                  const customerName =
                    customerResult.rows[0]?.full_name || null;

                  sessionsMap.set(sessionId, {
                    sessionId,
                    project: client.project,
                    isOnline: client.ws.readyState === WebSocket.OPEN,
                    customerName: customerName,
                    lastActivity: new Date(),
                  });
                } catch (err) {
                  console.error("Error getting customer name:", err);
                }
              }
            }

            allSessions.push(...sessionsMap.values());
          } catch (err) {
            console.error("Error fetching all sessions:", err);
          }

          ws.send(
            JSON.stringify({
              type: "unassigned_sessions",
              sessions: allSessions,
            }),
          );
        } catch (err) {
          ws.send(
            JSON.stringify({ type: "error", message: "Authentication failed" }),
          );
        }
      }

      // Agent takes/claims a session (multiple agents can claim same session)
      if (data.type === "agent_claim_session") {
        const { sessionId: targetSession, agentId } = data;

        // Get agent's current status
        const agentData = activeAgents.get(agentId);
        const agentStatus = agentData?.status || "online";

        // Only assign if agent status is "online"
        // Away/Busy agents can view but won't stop AI from responding
        if (agentStatus === "online") {
          const currentAssignment = sessionAssignments.get(targetSession);
          if (!currentAssignment) {
            assignSessionToAgent(targetSession, agentId);
          }

          // Track this agent as also watching this session
          if (activeAgents.has(agentId)) {
            activeAgents.get(agentId).assignedSessions.add(targetSession);
          }
        }

        ws.send(
          JSON.stringify({
            type: "claim_accepted",
            sessionId: targetSession,
            willStopAI: agentStatus === "online",
          }),
        );
      }

      // Agent status change (online/away/busy)
      if (data.type === "agent_status_change") {
        const { agentId, status } = data;
        if (activeAgents.has(agentId)) {
          const previousStatus = activeAgents.get(agentId).status;
          activeAgents.get(agentId).status = status;

          // If agent changed to away/busy, remove all their session assignments so AI can respond
          if (
            (status === "away" || status === "busy") &&
            previousStatus === "online"
          ) {
            console.log(
              `📤 Agent ${agentId} is now ${status}, removing session assignments`,
            );
            // Remove all sessions assigned to this agent
            for (const [
              sessionId,
              assignedAgent,
            ] of sessionAssignments.entries()) {
              if (assignedAgent === agentId) {
                sessionAssignments.delete(sessionId);
                console.log(
                  `🔓 Released session ${sessionId} from agent ${agentId}`,
                );
              }
            }
          }

          broadcastToAgents({
            type: "agent_status_updated",
            agentId,
            status,
          });
        }
      }

      // Page change
      if (data.type === "page_change") {
        currentPage = data.currentPage;
        const clientData = chatClients.get(clientSessionId);
        if (clientData) {
          clientData.currentPage = currentPage;
          chatClients.set(clientSessionId, clientData);
        }
        // Notify admins
        chatClients.forEach((client) => {
          if (
            client.type === "admin" &&
            client.ws.readyState === WebSocket.OPEN
          ) {
            client.ws.send(
              JSON.stringify({
                type: "page_change",
                sessionId: clientSessionId,
                currentPage: currentPage,
              }),
            );
          }
        });
      }

      // Typing indicator
      if (data.type === "typing") {
        const clientData = chatClients.get(clientSessionId);
        if (clientData) {
          clientData.isTyping = data.isTyping;
          chatClients.set(clientSessionId, clientData);
        }
        // Notify the other party
        if (clientType === "user") {
          // Notify agents that user is typing
          broadcastToAgents({
            type: "user_typing",
            sessionId: clientSessionId,
            isTyping: data.isTyping,
          });
        } else if (clientType === "agent" && data.targetSessionId) {
          // Agent typing - notify the user
          const targetClient = chatClients.get(data.targetSessionId);
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(
              JSON.stringify({
                type: "admin_typing",
                isTyping: data.isTyping,
              }),
            );
          }
        }
      }

      // Message delivered (user received the message)
      if (data.type === "message_delivered") {
        messageStatuses.set(data.messageId, {
          status: "delivered",
          timestamp: new Date(),
        });
        // Notify agents that message was delivered
        broadcastToAgents({
          type: "message_status_update",
          messageId: data.messageId,
          sessionId: clientSessionId,
          status: "delivered",
        });
      }

      // Message read (user saw the message)
      if (data.type === "message_read") {
        messageStatuses.set(data.messageId, {
          status: "read",
          timestamp: new Date(),
        });
        // Notify agents that message was read
        broadcastToAgents({
          type: "message_status_update",
          messageId: data.messageId,
          sessionId: clientSessionId,
          status: "read",
        });
      }

      // Mark all messages as read for a session
      if (data.type === "mark_all_read") {
        if (clientType === "user") {
          // User marked messages as read - notify agents
          broadcastToAgents({
            type: "all_messages_read",
            sessionId: clientSessionId,
          });
        } else if (clientType === "agent" && data.targetSessionId) {
          // Agent marked user messages as read - notify user
          console.log(
            `✅ Agent marked messages as read for session: ${data.targetSessionId}`,
          );
          console.log(
            `🔍 All connected clients:`,
            Array.from(chatClients.keys()),
          );
          const targetClient = chatClients.get(data.targetSessionId);
          console.log(`🔍 Target client found:`, targetClient ? "YES" : "NO");
          if (targetClient) {
            console.log(
              `🔍 WebSocket state:`,
              targetClient.ws.readyState,
              "(1=OPEN)",
            );
          }
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            console.log(
              `📤 Sending 'all_messages_read_by_agent' to user ${data.targetSessionId}`,
            );
            targetClient.ws.send(
              JSON.stringify({
                type: "all_messages_read_by_agent",
                sessionId: data.targetSessionId,
              }),
            );
          } else {
            console.log(
              `⚠️  User ${data.targetSessionId} not connected or not ready`,
            );
          }

          // Also notify the agent that messages are now marked as read
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: "all_messages_read",
                sessionId: data.targetSessionId,
              }),
            );
          }
        }
      }

      // User sends message
      if (data.type === "user_message") {
        const project = data.project || currentPage;
        console.log(`💬 User message from ${clientSessionId}: ${data.text}`);

        // Save message to database
        try {
          await pool.query(
            `INSERT INTO contact_messages (session_id, name, message, status, project, message_id, sender_type, file_url, file_type, file_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              clientSessionId,
              "Customer",
              data.text,
              "new",
              project,
              data.messageId,
              "customer",
              data.fileUrl || null,
              data.fileType || null,
              data.fileName || null,
            ],
          );
          console.log(
            `💾 Saved customer message to database: ${data.messageId}`,
          );
        } catch (dbError) {
          console.error("Error saving customer message to database:", dbError);
        }

        // Check if this session already requested human support
        const wantsHuman = needsHumanSupport(clientSessionId);

        // Check if session is assigned to an agent
        const assignedAgentId = sessionAssignments.get(clientSessionId);

        console.log(
          `📋 Session ${clientSessionId} - assignedAgentId: ${assignedAgentId}, wantsHuman: ${wantsHuman}`,
        );
        console.log(
          `📋 All session assignments:`,
          Object.fromEntries(sessionAssignments),
        );
        console.log(`📋 Active agents:`, Array.from(activeAgents.keys()));

        // Fetch customer info if available
        let customerInfo = null;
        try {
          const customerResult = await pool.query(
            "SELECT * FROM chat_customers WHERE session_id = $1",
            [clientSessionId],
          );
          if (customerResult.rows.length > 0) {
            customerInfo = {
              customerId: customerResult.rows[0].customer_id,
              fullName: customerResult.rows[0].full_name,
              email: customerResult.rows[0].email,
              phone: customerResult.rows[0].phone,
              ipAddress: customerResult.rows[0].ip_address,
              country: customerResult.rows[0].country,
            };
          }
        } catch (error) {
          console.error("Error fetching customer info:", error);
        }

        // Send user message to ALL online agents (any agent can respond)
        if (activeAgents.size > 0) {
          broadcastToAgents({
            type: "new_user_message",
            sessionId: clientSessionId,
            text: data.text,
            timestamp: new Date().toISOString(),
            messageId: data.messageId,
            project: project,
            needsHumanSupport: wantsHuman,
            isAssignedToMe: true,
            isOnline: ws.readyState === WebSocket.OPEN,
            customerInfo: customerInfo,
            fileUrl: data.fileUrl,
            fileType: data.fileType,
            fileName: data.fileName,
          });

          // Send delivered status back to user
          if (ws.readyState === WebSocket.OPEN) {
            console.log(
              `📬 Sending 'delivered' status for message ${data.messageId} to user`,
            );
            ws.send(
              JSON.stringify({
                type: "message_status_update",
                messageId: data.messageId,
                status: "delivered",
              }),
            );
          }
        }

        // AI auto-response - only if admin enabled it AND session not assigned to agent
        if (aiEnabled && !assignedAgentId) {
          const aiResponse = generateAIResponse(data.text, clientSessionId);
          console.log(`🤖 AI Response: ${aiResponse.text}`);

          setTimeout(
            async () => {
              const aiMessageId = `ai_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: "admin_message",
                    text: aiResponse.text,
                    timestamp: new Date().toISOString(),
                    adminName: "Support",
                    messageId: aiMessageId,
                  }),
                );
              }

              try {
                await pool.query(
                  "INSERT INTO contact_replies (message_id, reply_text, admin_name) VALUES ($1, $2, $3)",
                  [data.messageId, aiResponse.text, "Support"],
                );
              } catch (err) {
                console.error("Error saving AI response:", err);
              }

              broadcastToAgents({
                type: "agent_replied",
                sessionId: clientSessionId,
                agentId: "ai",
                agentName: "Support (AI)",
                text: aiResponse.text,
                messageId: aiMessageId,
                timestamp: new Date().toISOString(),
                isAI: true,
              });

              setTimeout(() => {
                broadcastToAgents({
                  type: "message_status_update",
                  messageId: aiMessageId,
                  sessionId: clientSessionId,
                  status: "delivered",
                });
              }, 100);

              if (aiResponse.isHumanRequest) {
                pool
                  .query(
                    "SELECT full_name FROM chat_customers WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1",
                    [clientSessionId],
                  )
                  .then((result) => {
                    broadcastToAgents({
                      type: "human_support_requested",
                      sessionId: clientSessionId,
                      project: project,
                      customerName: result.rows[0]?.full_name || null,
                      timestamp: new Date().toISOString(),
                    });
                  })
                  .catch(() => {});
              }
            },
            1000 + Math.random() * 1000,
          );
        }
      }

      // Admin sends reply
      if (data.type === "admin_reply") {
        console.log(
          `📨 Admin reply to session ${data.targetSessionId}: ${data.text}`,
        );
        const targetClient = chatClients.get(data.targetSessionId);
        if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
          targetClient.ws.send(
            JSON.stringify({
              type: "admin_message",
              text: data.text,
              timestamp: new Date().toISOString(),
              adminName: data.adminName || "Support",
            }),
          );
        }
      }

      // Admin online status - notify user
      if (data.type === "admin_online_status") {
        const targetClient = chatClients.get(data.targetSessionId);
        if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
          targetClient.ws.send(
            JSON.stringify({
              type: "admin_online",
              online: data.online,
            }),
          );
        }
      }

      // Admin read messages - notify user that messages were read (green ticks)
      if (data.type === "admin_read_messages") {
        const targetClient = chatClients.get(data.targetSessionId);
        if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
          targetClient.ws.send(
            JSON.stringify({
              type: "all_messages_read",
              sessionId: data.targetSessionId,
            }),
          );
        }
      }

      // Handle agent sending message to customer
      if (data.type === "agent_message") {
        const targetSessionId = data.sessionId;
        const agentId = data.agentId;

        console.log(
          `📨 Agent ${agentId} sending message to session ${targetSessionId}`,
        );

        // Save agent message to database
        try {
          await pool.query(
            `INSERT INTO contact_messages (session_id, name, message, status, project, message_id, sender_type, agent_id, agent_name, file_url, file_type, file_name)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              targetSessionId,
              data.agentName || "Agent",
              data.text,
              "replied",
              null,
              data.messageId,
              "agent",
              agentId,
              data.agentName,
              data.fileUrl || null,
              data.fileType || null,
              data.fileName || null,
            ],
          );
          console.log(`💾 Saved agent message to database: ${data.messageId}`);
        } catch (dbError) {
          console.error("Error saving agent message to database:", dbError);
        }

        // Auto-assign session if not yet assigned AND agent is "online"
        // Away/Busy agents can send messages but won't stop AI
        const assignedAgentId = sessionAssignments.get(targetSessionId);
        const agentData = activeAgents.get(agentId);
        const agentStatus = agentData?.status || "online";

        if (!assignedAgentId && agentStatus === "online") {
          console.log(
            `📋 Auto-assigning session ${targetSessionId} to online agent ${agentId}`,
          );
          assignSessionToAgent(targetSessionId, agentId);
        } else if (agentStatus !== "online") {
          console.log(
            `ℹ️ Agent ${agentId} is ${agentStatus}, not assigning session (AI will continue)`,
          );
        }
        // Any agent can write to any session - no restriction

        // Forward message to customer via WebSocket
        const customerClient = chatClients.get(targetSessionId);
        if (customerClient && customerClient.ws.readyState === WebSocket.OPEN) {
          console.log(
            `✅ Forwarding agent message to customer ${targetSessionId}`,
          );
          customerClient.ws.send(
            JSON.stringify({
              type: "admin_message",
              text: data.text,
              timestamp: data.timestamp || new Date().toISOString(),
              adminName: data.agentName,
              agentName: data.agentName,
              messageId: data.messageId,
              fileUrl: data.fileUrl,
              fileType: data.fileType,
              fileName: data.fileName,
            }),
          );

          // Send delivered status back to agent
          ws.send(
            JSON.stringify({
              type: "message_status_update",
              messageId: data.messageId,
              status: "delivered",
            }),
          );
        } else {
          console.log(
            `📴 Customer ${targetSessionId} is offline or connection closed`,
          );
        }

        // Broadcast to other agents watching this session
        broadcastToAgents(
          {
            type: "agent_replied",
            sessionId: targetSessionId,
            agentId: agentId,
            agentName: data.agentName,
            text: data.text,
            messageId: data.messageId,
            timestamp: data.timestamp || new Date().toISOString(),
            fileUrl: data.fileUrl,
            fileType: data.fileType,
            fileName: data.fileName,
          },
          agentId,
        ); // Exclude sender
      }

      // Handle file deletion
      if (data.type === "file_deleted") {
        const targetSessionId = data.sessionId;
        const messageId = data.messageId;

        console.log(
          `🗑️ File deleted from session ${targetSessionId}, message ${messageId}`,
        );

        // If sender is customer, notify assigned agent
        if (clientType === "user") {
          const assignedAgentId = sessionAssignments.get(targetSessionId);
          if (assignedAgentId) {
            const agent = activeAgents.get(assignedAgentId);
            if (agent && agent.ws && agent.ws.readyState === WebSocket.OPEN) {
              agent.ws.send(
                JSON.stringify({
                  type: "file_deleted",
                  sessionId: targetSessionId,
                  messageId: messageId,
                }),
              );
              console.log(
                `✅ Notified agent ${assignedAgentId} about file deletion`,
              );
            }
          }
        }

        // If sender is agent, notify customer
        if (clientType === "agent") {
          const customerClient = chatClients.get(targetSessionId);
          if (
            customerClient &&
            customerClient.ws.readyState === WebSocket.OPEN
          ) {
            customerClient.ws.send(
              JSON.stringify({
                type: "file_deleted",
                sessionId: targetSessionId,
                messageId: messageId,
              }),
            );
            console.log(
              `✅ Notified customer ${targetSessionId} about file deletion`,
            );
          }

          // Also notify other agents watching this session
          broadcastToAgents(
            {
              type: "file_deleted",
              sessionId: targetSessionId,
              messageId: messageId,
            },
            clientSessionId,
          ); // Exclude sender
        }
      }
    } catch (error) {
      console.error("WebSocket message error:", error);
    }
  });

  ws.on("close", () => {
    if (clientSessionId) {
      chatClients.delete(clientSessionId);
      console.log(
        `📴 Chat client disconnected: ${clientType} (${clientSessionId})`,
      );

      // Handle user disconnect
      if (clientType === "user") {
        // Clear IP session mapping
        clearIPSession(clientIP, clientSessionId);

        // Notify all agents
        broadcastToAgents({
          type: "user_disconnected",
          sessionId: clientSessionId,
        });
      }

      // Handle agent disconnect
      if (clientType === "agent") {
        const agent = activeAgents.get(clientSessionId);
        if (agent) {
          // Release all assigned sessions back to pool
          agent.assignedSessions.forEach((sessionId) => {
            sessionAssignments.delete(sessionId);
          });

          activeAgents.delete(clientSessionId);
          console.log(
            `👤 Agent disconnected: ${agent.name} (${clientSessionId})`,
          );

          // Notify other agents
          broadcastToAgents({
            type: "agent_disconnected",
            agentId: clientSessionId,
            agentName: agent.name,
            releasedSessions: Array.from(agent.assignedSessions),
          });

          // Update agents list
          broadcastToAgents({
            type: "agents_list_updated",
            agents: getOnlineAgents(),
          });

          // Notify all users about agent status (if no agents left, notify offline)
          const hasOnlineAgents = activeAgents.size > 0;
          chatClients.forEach((client) => {
            if (
              client.type === "user" &&
              client.ws.readyState === WebSocket.OPEN
            ) {
              client.ws.send(
                JSON.stringify({
                  type: "admin_online",
                  online: hasOnlineAgents,
                }),
              );
            }
          });
        }
      }
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

console.log(`🔌 WebSocket server running on port ${WS_PORT}`);

// PostgreSQL connection for Chat System
const poolConfig = {
  host: process.env.DB_HOST || "localhost",
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || "chat_system_db",
  user: process.env.DB_USER || process.env.USER,
};

// Only add password if it exists
if (process.env.DB_PASSWORD) {
  poolConfig.password = process.env.DB_PASSWORD;
}

const pool = new Pool(poolConfig);

// Test database connection
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("❌ Database connection failed:", err.message);
  } else {
    console.log("✅ Database connected successfully");
  }
});

// ==================== ENDPOINTS ====================

// ==================== DEVICE TRACKING & SECURITY ====================

// Get or create device ID
app.get("/api/chat/device", (req, res) => {
  let deviceId = req.cookies.device_id;

  if (!deviceId) {
    // Generate new device ID
    deviceId = `dev_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;

    // Set HTTP-only cookie (7 days)
    res.cookie("device_id", deviceId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });
  }

  res.json({
    success: true,
    deviceId: deviceId,
  });
});

// ==================== AGENT ENDPOINTS ====================

// Agent login
app.post("/api/agent/login", async (req, res) => {
  const { agentId, password } = req.body;

  const agent = await authenticateAgent(agentId, password);
  if (!agent) {
    return res
      .status(401)
      .json({ success: false, error: "Invalid credentials" });
  }

  // Generate token
  const token = jwt.sign(
    { agentId: agent.id, name: agent.name, role: agent.role },
    "agent-secret-key",
    { expiresIn: "8h" },
  );

  res.json({
    success: true,
    token,
    agent: { id: agent.id, name: agent.name, role: agent.role },
  });
});

// Admin login
app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body;

  // Admin credentials - in production, store these in database with bcrypt
  const ADMIN_CREDENTIALS = {
    username: "admin",
    password: "admin123", // Change this in production!
  };

  if (
    username === ADMIN_CREDENTIALS.username &&
    password === ADMIN_CREDENTIALS.password
  ) {
    // Generate admin token
    const token = jwt.sign(
      { username, role: "admin", type: "admin" },
      "admin-secret-key-change-in-production",
      { expiresIn: "24h" },
    );

    res.json({
      success: true,
      token,
      admin: { username, role: "admin" },
    });
  } else {
    res
      .status(401)
      .json({ success: false, error: "Invalid admin credentials" });
  }
});

// Get all agents (from database + online status)
app.get("/api/agents", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, username, name, email, role, created_at FROM agents ORDER BY created_at",
    );

    // Merge with online status
    const agents = result.rows.map((agent) => {
      const onlineAgent = Array.from(activeAgents.values()).find(
        (a) => a.id === agent.id,
      );
      return {
        ...agent,
        isOnline: !!onlineAgent,
        status: onlineAgent?.status || "offline",
        assignedCount: onlineAgent?.assignedSessions?.size || 0,
      };
    });

    res.json({ success: true, agents });
  } catch (error) {
    console.error("Error fetching agents:", error);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

// AI toggle endpoints (admin only)
app.get("/api/admin/ai-settings", (req, res) => {
  res.json({ success: true, aiEnabled });
});

app.post("/api/admin/ai-settings", (req, res) => {
  const { enabled } = req.body;
  aiEnabled = !!enabled;
  console.log(
    `🤖 AI auto-response ${aiEnabled ? "ENABLED" : "DISABLED"} by admin`,
  );
  broadcastToAgents({ type: "ai_status_changed", aiEnabled });
  res.json({ success: true, aiEnabled });
});

// Get all customers (admin only)
app.get("/api/admin/customers", async (req, res) => {
  try {
    // First, ensure VPN columns exist
    try {
      await pool.query(`
        ALTER TABLE chat_customers
        ADD COLUMN IF NOT EXISTS is_vpn BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS vpn_provider VARCHAR(255)
      `);
    } catch (alterError) {
      console.log("VPN columns check:", alterError.message);
    }

    const result = await pool.query(
      "SELECT id, session_id, full_name, email, phone, country, ip_address, is_vpn, vpn_provider, created_at FROM chat_customers ORDER BY created_at DESC",
    );

    res.json({ success: true, customers: result.rows });
  } catch (error) {
    console.error("Error fetching customers:", error);
    // If still fails, try without VPN columns
    try {
      const fallbackResult = await pool.query(
        "SELECT id, session_id, full_name, email, phone, country, ip_address, created_at FROM chat_customers ORDER BY created_at DESC",
      );
      res.json({ success: true, customers: fallbackResult.rows });
    } catch (fallbackError) {
      res.json({ success: true, customers: [] });
    }
  }
});

// Create new agent
app.post("/api/agent/create", async (req, res) => {
  try {
    const { username, password, name, email } = req.body;

    if (!username || !password || !name || !email) {
      return res
        .status(400)
        .json({ success: false, message: "All fields required" });
    }

    // Check if username or email already exists
    const existing = await pool.query(
      "SELECT id FROM agents WHERE username = $1 OR email = $2",
      [username, email],
    );

    if (existing.rows.length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "Username or email already exists" });
    }

    // Generate agent ID
    const agentId = `agent_${Date.now()}`;

    // Hash password (for now using bcrypt)
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert agent
    await pool.query(
      "INSERT INTO agents (id, username, password_hash, name, email, role) VALUES ($1, $2, $3, $4, $5, $6)",
      [agentId, username, passwordHash, name, email, "support"],
    );

    res.json({
      success: true,
      message: "Agent created successfully",
      agent: { id: agentId, username, name, email },
    });
  } catch (error) {
    console.error("Error creating agent:", error);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

// Delete agent
app.delete("/api/agent/:agentId", async (req, res) => {
  try {
    const { agentId } = req.params;

    // Check if agent exists
    const result = await pool.query("SELECT id FROM agents WHERE id = $1", [
      agentId,
    ]);

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Agent not found" });
    }

    // Delete agent
    await pool.query("DELETE FROM agents WHERE id = $1", [agentId]);

    // Remove from active agents if online
    if (activeAgents.has(agentId)) {
      const agent = activeAgents.get(agentId);
      // Release all their sessions
      agent.assignedSessions.forEach((sessionId) => {
        sessionAssignments.delete(sessionId);
      });
      activeAgents.delete(agentId);
    }

    res.json({ success: true, message: "Agent deleted successfully" });
  } catch (error) {
    console.error("Error deleting agent:", error);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

// Get unassigned sessions (sessions waiting for an agent)
app.get("/api/agent/unassigned-sessions", (req, res) => {
  const unassigned = [];
  chatClients.forEach((client, sessionId) => {
    if (client.type === "user" && !sessionAssignments.has(sessionId)) {
      unassigned.push({
        sessionId,
        project: client.project,
        isOnline: client.ws.readyState === WebSocket.OPEN,
      });
    }
  });
  res.json({ success: true, sessions: unassigned });
});

// Assign session to agent
app.post("/api/agent/assign", (req, res) => {
  const { sessionId, agentId } = req.body;

  if (!activeAgents.has(agentId)) {
    return res.status(400).json({ success: false, error: "Agent not online" });
  }

  assignSessionToAgent(sessionId, agentId);
  res.json({ success: true, message: "Session assigned" });
});

// Release session from agent
app.post("/api/agent/release", (req, res) => {
  const { sessionId } = req.body;

  const agentId = sessionAssignments.get(sessionId);
  if (agentId && activeAgents.has(agentId)) {
    activeAgents.get(agentId).assignedSessions.delete(sessionId);
  }
  sessionAssignments.delete(sessionId);

  broadcastToAgents({
    type: "session_released",
    sessionId,
  });

  res.json({ success: true, message: "Session released" });
});

// Log security event (called on each message/session)
app.post("/api/chat/security-log", async (req, res) => {
  try {
    const { sessionId, eventType, deviceId } = req.body;
    const ipAddress =
      req.ip || req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const userAgent = req.headers["user-agent"];

    // Check IP-based session limit (1 session per IP)
    if (eventType === "session" || eventType === "message") {
      const ipCheck = checkIPSession(ipAddress, sessionId);
      if (!ipCheck.allowed) {
        return res.status(429).json({
          success: false,
          error: ipCheck.reason,
          existingSessionId: ipCheck.existingSessionId,
        });
      }
      // Register this IP-session pair
      registerIPSession(ipAddress, sessionId);
    }

    // Check if device/session is blocked
    const blocked = await pool.query(
      "SELECT * FROM chat_blocklist WHERE session_id = $1 OR device_id = $2 OR ip_address = $3",
      [sessionId, deviceId, ipAddress],
    );

    if (blocked.rows.length > 0) {
      const block = blocked.rows[0];
      if (!block.blocked_until || new Date(block.blocked_until) > new Date()) {
        return res.status(403).json({
          success: false,
          error: "Access blocked",
          reason: block.reason,
        });
      }
    }

    // Check rate limits
    const rateCheck = checkRateLimit(deviceId || ipAddress, eventType);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: rateCheck.reason,
      });
    }

    // Return IP address for client to store
    res.json({
      success: true,
      allowed: true,
      ipAddress: ipAddress,
    });
  } catch (error) {
    console.error("Security log error:", error);
    res.status(500).json({ success: false, error: "Security check failed" });
  }
});

// Block a device/session (Admin)
app.post("/api/chat/block", async (req, res) => {
  try {
    const { sessionId, deviceId, ipAddress, reason, durationDays } = req.body;

    const blockedUntil = durationDays
      ? new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
      : null; // null = permanent

    await pool.query(
      `
      INSERT INTO chat_blocklist (session_id, device_id, ip_address, reason, blocked_until)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (session_id) DO UPDATE SET
        device_id = COALESCE($2, chat_blocklist.device_id),
        ip_address = COALESCE($3, chat_blocklist.ip_address),
        reason = $4,
        blocked_until = $5
    `,
      [sessionId, deviceId, ipAddress, reason, blockedUntil],
    );

    res.json({
      success: true,
      message: "Block applied successfully",
    });
  } catch (error) {
    console.error("Block error:", error);
    res.status(500).json({ success: false, error: "Failed to apply block" });
  }
});

// Unblock a session (Admin)
app.delete("/api/chat/block/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    await pool.query("DELETE FROM chat_blocklist WHERE session_id = $1", [
      sessionId,
    ]);

    res.json({
      success: true,
      message: "Block removed successfully",
    });
  } catch (error) {
    console.error("Unblock error:", error);
    res.status(500).json({ success: false, error: "Failed to remove block" });
  }
});

// Get blocklist (Admin)
app.get("/api/chat/blocklist", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM chat_blocklist ORDER BY created_at DESC",
    );
    res.json({
      success: true,
      blocklist: result.rows,
    });
  } catch (error) {
    console.error("Get blocklist error:", error);
    res.status(500).json({ success: false, error: "Failed to get blocklist" });
  }
});

// ==================== FILE UPLOAD ====================

// Upload file endpoint
app.post("/api/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, error: "No file uploaded" });
    }

    // Generate proper URL based on environment and request
    const protocol = req.get("x-forwarded-proto") || req.protocol || "http";
    const host =
      req.get("x-forwarded-host") || req.get("host") || "localhost:5003";
    const fileUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

    const fileType = req.file.mimetype.split("/")[0]; // 'image', 'video', 'application'

    res.json({
      success: true,
      file: {
        url: fileUrl,
        filename: req.file.filename,
        originalName: req.file.originalname,
        type: fileType,
        size: req.file.size,
      },
    });
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ success: false, error: "Upload failed" });
  }
});

// Delete file endpoint
app.delete("/api/upload/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(__dirname, "uploads", filename);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: "File not found" });
    }

    // Delete the file
    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Delete error:", error);
    res.status(500).json({ success: false, error: "Delete failed" });
  }
});

// ==================== CONTACT MESSAGES ====================

// Submit contact message (with rate limiting)
app.post("/api/contact", async (req, res) => {
  try {
    const { name, email, message, project, fileUrl, fileType } = req.body;

    console.log("📨 /api/contact received:", {
      name,
      message,
      fileUrl,
      fileType,
    });

    // Allow empty message if there's a file attachment
    if (!name || (!message && !fileUrl)) {
      console.log(
        "❌ Validation failed - name:",
        name,
        "message:",
        message,
        "fileUrl:",
        fileUrl,
      );
      return res.status(400).json({
        success: false,
        error: "Name and message or file are required",
      });
    }

    // Extract filename from fileUrl if provided
    const fileName = fileUrl ? fileUrl.split("/").pop() : null;

    const result = await pool.query(
      "INSERT INTO contact_messages (session_id, name, message, status, project, file_url, file_type, file_name, sender_type) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
      [
        name,
        name,
        message,
        "new",
        project || null,
        fileUrl || null,
        fileType || null,
        fileName,
        "customer",
      ],
    );

    res.json({
      success: true,
      message: "Message received successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error saving contact message:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save message",
    });
  }
});

// Get all contact messages (Admin)
app.get("/api/contact/messages", async (req, res) => {
  try {
    const messagesResult = await pool.query(
      "SELECT * FROM contact_messages ORDER BY created_at DESC",
    );

    // Get replies for each message
    const messages = await Promise.all(
      messagesResult.rows.map(async (msg) => {
        const repliesResult = await pool.query(
          "SELECT * FROM contact_replies WHERE message_id = $1 ORDER BY created_at ASC",
          [msg.id],
        );

        return {
          ...msg,
          replies: repliesResult.rows.map((r) => ({
            text: r.reply_text,
            admin: r.admin_name,
            timestamp: r.created_at,
          })),
        };
      }),
    );

    res.json({
      success: true,
      messages: messages,
    });
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch messages",
    });
  }
});

// Get user's own messages by sessionId
app.get("/api/contact/user-messages/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const messagesResult = await pool.query(
      "SELECT * FROM contact_messages WHERE name = $1 ORDER BY created_at ASC",
      [sessionId],
    );

    // Get replies for each message
    const messages = await Promise.all(
      messagesResult.rows.map(async (msg) => {
        const repliesResult = await pool.query(
          "SELECT * FROM contact_replies WHERE message_id = $1 ORDER BY created_at ASC",
          [msg.id],
        );

        return {
          id: msg.id,
          text: msg.message,
          timestamp: msg.created_at,
          sender: "user",
          fileUrl: msg.file_url,
          fileType: msg.file_type,
          fileName: msg.file_name,
          replies: repliesResult.rows.map((r) => ({
            id: r.id,
            text: r.reply_text,
            admin: r.admin_name,
            timestamp: r.created_at,
            sender: "system",
            fileUrl: r.file_url,
            fileType: r.file_type,
            fileName: r.file_name,
          })),
        };
      }),
    );

    res.json({
      success: true,
      messages: messages,
    });
  } catch (error) {
    console.error("Error fetching user messages:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch user messages",
    });
  }
});

// Send reply to contact message (Admin)
app.post("/api/contact/reply", async (req, res) => {
  try {
    const { messageId, reply, email, userId, agentId, agentName } = req.body;

    if (!messageId || !reply || !email) {
      return res.status(400).json({
        success: false,
        error: "Message ID, reply, and email are required",
      });
    }

    const adminName = agentName || "Support";

    // Save reply to database
    await pool.query(
      "INSERT INTO contact_replies (message_id, reply_text, admin_name, agent_id) VALUES ($1, $2, $3, $4)",
      [messageId, reply, adminName, agentId || null],
    );

    // Update message status
    await pool.query(
      "UPDATE contact_messages SET status = $1, updated_at = NOW() WHERE id = $2",
      ["replied", messageId],
    );

    // NOTE: WebSocket delivery is handled by 'agent_message' WebSocket handler
    // This REST endpoint only saves to database to prevent duplicate messages
    console.log(
      `💾 Reply saved to database for user ${userId}, WebSocket delivery handled separately`,
    );

    // TODO: Send email notification here
    console.log(`Email would be sent to: ${email}`);
    console.log(`Reply: ${reply}`);

    res.json({
      success: true,
      message: "Reply sent successfully",
    });
  } catch (error) {
    console.error("Error sending reply:", error);
    res.status(500).json({
      success: false,
      error: "Failed to send reply",
    });
  }
});

// Update message status (Admin)
app.put("/api/contact/status", async (req, res) => {
  try {
    const { messageId, status } = req.body;

    if (!messageId || !status) {
      return res.status(400).json({
        success: false,
        error: "Message ID and status are required",
      });
    }

    await pool.query(
      "UPDATE contact_messages SET status = $1, updated_at = NOW() WHERE id = $2",
      [status, messageId],
    );

    res.json({
      success: true,
      message: "Status updated successfully",
    });
  } catch (error) {
    console.error("Error updating status:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update status",
    });
  }
});

// Delete contact message (Admin)
app.delete("/api/contact/message/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Delete replies first (cascade)
    await pool.query("DELETE FROM contact_replies WHERE message_id = $1", [id]);

    // Delete message
    await pool.query("DELETE FROM contact_messages WHERE id = $1", [id]);

    res.json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete message",
    });
  }
});

// Delete all messages for a user (Admin)
app.delete("/api/contact/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Get all message IDs for this user
    const messagesResult = await pool.query(
      "SELECT id FROM contact_messages WHERE name = $1",
      [userId],
    );

    // Delete all replies for these messages
    for (const msg of messagesResult.rows) {
      await pool.query("DELETE FROM contact_replies WHERE message_id = $1", [
        msg.id,
      ]);
    }

    // Delete all messages from this user
    await pool.query("DELETE FROM contact_messages WHERE name = $1", [userId]);

    res.json({
      success: true,
      message: "User and all messages deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({
      success: false,
      error: "Failed to delete user",
    });
  }
});

// ==================== CHAT CUSTOMERS ====================

// Create or update customer (after form submission)
app.post("/api/chat/customer", async (req, res) => {
  try {
    const { sessionId, fullName, email, phone, clientIp, clientCountry } =
      req.body;

    if (!sessionId || !fullName || !email || !phone) {
      return res.status(400).json({
        success: false,
        error: "All fields are required",
      });
    }

    // Check if fullName or email is already used by another session
    const duplicateCheck = await pool.query(
      "SELECT session_id, full_name, email FROM chat_customers WHERE (LOWER(full_name) = LOWER($1) OR LOWER(email) = LOWER($2)) AND session_id != $3",
      [fullName, email, sessionId],
    );

    if (duplicateCheck.rows.length > 0) {
      const dup = duplicateCheck.rows[0];
      const dupField =
        dup.full_name.toLowerCase() === fullName.toLowerCase()
          ? "username"
          : "email";
      return res.status(409).json({
        success: false,
        error: `This ${dupField} is already in use. Please use a different ${dupField}.`,
        field: dupField,
      });
    }

    // Use client-provided IP/Country if available (more accurate), otherwise fallback to server detection
    let ipAddress = clientIp || "Unknown";
    let country = clientCountry || "Unknown";

    // If client didn't provide IP, try to get from request headers
    if (ipAddress === "Unknown") {
      ipAddress =
        req.headers["x-forwarded-for"]?.split(",")[0] ||
        req.headers["x-real-ip"] ||
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        "Unknown";
      ipAddress = ipAddress.replace("::ffff:", "");
    }

    // VPN/Proxy Detection
    let isVpn = false;
    let vpnProvider = null;

    if (
      ipAddress !== "Unknown" &&
      !ipAddress.startsWith("127.") &&
      !ipAddress.startsWith("192.168.")
    ) {
      try {
        const vpnCheckResponse = await fetch(
          `http://proxycheck.io/v2/${ipAddress}?vpn=1&asn=1`,
        );
        const vpnData = await vpnCheckResponse.json();

        if (vpnData[ipAddress]) {
          isVpn =
            vpnData[ipAddress].proxy === "yes" ||
            vpnData[ipAddress].type === "VPN";
          vpnProvider = vpnData[ipAddress].provider || null;
          console.log(
            `🔍 VPN Check for ${ipAddress}: ${isVpn ? "VPN/Proxy detected" : "Clean"}`,
          );
        }
      } catch (vpnError) {
        console.error("VPN check failed:", vpnError);
        // Continue without VPN detection if service fails
      }
    }

    // Check if customer already exists for this session
    const existingCustomer = await pool.query(
      "SELECT * FROM chat_customers WHERE session_id = $1",
      [sessionId],
    );

    let customerId;

    // Add VPN columns if they don't exist
    try {
      await pool.query(`
        ALTER TABLE chat_customers
        ADD COLUMN IF NOT EXISTS is_vpn BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS vpn_provider VARCHAR(255)
      `);
    } catch (alterError) {
      console.log("VPN columns already exist or error:", alterError.message);
    }

    if (existingCustomer.rows.length > 0) {
      // Update existing customer
      const result = await pool.query(
        "UPDATE chat_customers SET full_name = $1, email = $2, phone = $3, ip_address = $4, country = $5, is_vpn = $6, vpn_provider = $7, updated_at = NOW() WHERE session_id = $8 RETURNING customer_id",
        [
          fullName,
          email,
          phone,
          ipAddress,
          country,
          isVpn,
          vpnProvider,
          sessionId,
        ],
      );
      customerId = result.rows[0].customer_id;
    } else {
      // Create new customer
      const result = await pool.query(
        "INSERT INTO chat_customers (session_id, full_name, email, phone, ip_address, country, is_vpn, vpn_provider) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING customer_id",
        [
          sessionId,
          fullName,
          email,
          phone,
          ipAddress,
          country,
          isVpn,
          vpnProvider,
        ],
      );
      customerId = result.rows[0].customer_id;
    }

    // Notify agents about customer info update via WebSocket
    const customerInfoUpdate = {
      type: "customer_info_update",
      sessionId: sessionId,
      customerInfo: {
        customerId: customerId,
        fullName: fullName,
        email: email,
        phone: phone,
        ipAddress: ipAddress,
        country: country,
        isVpn: isVpn,
        vpnProvider: vpnProvider,
      },
    };

    // Send to all agents
    broadcastToAgents(customerInfoUpdate);

    console.log(
      `📋 Customer info saved for session ${sessionId}: ${fullName} (${country})`,
    );

    res.json({
      success: true,
      customerId: customerId,
      message: "Customer saved successfully",
    });
  } catch (error) {
    console.error("Error saving customer:", error);
    res.status(500).json({
      success: false,
      error: "Failed to save customer",
    });
  }
});

// Get customer by session ID
app.get("/api/chat/customer/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await pool.query(
      "SELECT * FROM chat_customers WHERE session_id = $1",
      [sessionId],
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, customer: null });
    }

    res.json({
      success: true,
      customer: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching customer:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customer",
    });
  }
});

// Search customers (Admin)
app.get("/api/chat/customers/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      // Return all customers if no search query
      const result = await pool.query(
        "SELECT * FROM chat_customers ORDER BY created_at DESC LIMIT 100",
      );
      return res.json({ success: true, customers: result.rows });
    }

    // Search by name, email, phone, or customer ID
    const result = await pool.query(
      `
      SELECT * FROM chat_customers
      WHERE
        full_name ILIKE $1 OR
        email ILIKE $1 OR
        phone ILIKE $1 OR
        CAST(customer_id AS TEXT) = $2
      ORDER BY created_at DESC
      LIMIT 50
    `,
      [`%${query}%`, query],
    );

    res.json({
      success: true,
      customers: result.rows,
    });
  } catch (error) {
    console.error("Error searching customers:", error);
    res.status(500).json({
      success: false,
      error: "Failed to search customers",
    });
  }
});

// Get all customers with their sessions (Admin)
app.get("/api/chat/customers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.*,
        (SELECT COUNT(*) FROM contact_messages WHERE name = c.session_id) as message_count
      FROM chat_customers c
      ORDER BY c.created_at DESC
    `);

    res.json({
      success: true,
      customers: result.rows,
    });
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customers",
    });
  }
});

// Alias for /api/chat/customers
app.get("/api/chat/customers/all", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        c.*,
        (SELECT COUNT(*) FROM contact_messages WHERE name = c.session_id) as message_count
      FROM chat_customers c
      ORDER BY c.created_at DESC
    `);

    res.json({
      success: true,
      customers: result.rows,
    });
  } catch (error) {
    console.error("Error fetching customers:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch customers",
    });
  }
});

// Flag customer as scam (Admin)
app.post("/api/chat/customer/:customerId/flag", async (req, res) => {
  try {
    const { customerId } = req.params;
    const { isScam, reason } = req.body;

    await pool.query(
      "UPDATE chat_customers SET is_scam = $1, scam_reason = $2, updated_at = NOW() WHERE customer_id = $3",
      [isScam, reason || null, customerId],
    );

    // If flagged as scam, add to blocklist
    if (isScam) {
      const customer = await pool.query(
        "SELECT session_id FROM chat_customers WHERE customer_id = $1",
        [customerId],
      );
      if (customer.rows.length > 0) {
        await pool.query(
          "INSERT INTO chat_blocklist (session_id, reason, blocked_until) VALUES ($1, $2, $3) ON CONFLICT (session_id) DO UPDATE SET reason = $2, blocked_until = $3",
          [customer.rows[0].session_id, reason || "Flagged as scam", null],
        );
      }
    }

    res.json({
      success: true,
      message: isScam ? "Customer flagged as scam and blocked" : "Flag removed",
    });
  } catch (error) {
    console.error("Error flagging customer:", error);
    res.status(500).json({
      success: false,
      error: "Failed to flag customer",
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    success: true,
    service: "White-Label Chat System API",
    status: "running",
    timestamp: Date.now(),
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║         White-Label Chat System API                      ║
║                                                          ║
║  Status: Running                                         ║
║  Port: ${PORT}                                           ║
║  WebSocket Port: ${WS_PORT}                              ║
║  Database: chat_system_db                                ║
║                                                          ║
║  Chat Endpoints:                                         ║
║  - GET  /api/chat/device                                ║
║  - POST /api/agent/login                                ║
║  - GET  /api/agents                                     ║
║  - POST /api/contact                                    ║
║  - GET  /api/contact/messages                           ║
║  - POST /api/chat/customer                              ║
║  - GET  /health                                         ║
╚══════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
