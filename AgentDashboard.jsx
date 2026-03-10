import { useState, useEffect, useRef } from 'react';
import { MessageCircle, User, Send, Globe, X, Users, LogOut, Circle, Check, CheckCheck, Paperclip, Image, Video, File, Menu, ShieldAlert, Download, UserCircle } from 'lucide-react';
import AgentLogin from './AgentLogin';

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:5003' : '';
const WS_URL = window.location.hostname === 'localhost'
  ? 'ws://localhost:5004'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}/ws`;

/**
 * Multi-Agent Dashboard
 * Support agents can claim and manage chat sessions
 */
function AgentDashboard() {
  // Auth state
  const [agent, setAgent] = useState(null);
  const [token, setToken] = useState(null);

  // Sessions state - all sessions visible to all agents
  const [allSessions, setAllSessions] = useState(new Map()); // All chat sessions
  const [onlineAgents, setOnlineAgents] = useState([]); // Online agents
  const [unreadCounts, setUnreadCounts] = useState({}); // { sessionId: count }

  // UI state
  const [selectedSession, setSelectedSession] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [agentStatus, setAgentStatus] = useState('online'); // online, away, busy
  const [showSidebar, setShowSidebar] = useState(false); // Mobile sidebar toggle

  // Typing
  const [userTyping, setUserTyping] = useState({});
  const typingTimeoutRefs = useRef(new Map());
  const lastTypingRef = useRef(new Map());

  // Message status tracking
  const [messageStatuses, setMessageStatuses] = useState({}); // { messageId: 'sent' | 'delivered' | 'read' }

  // File upload states
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Image zoom modal state
  const [selectedImage, setSelectedImage] = useState(null);

  // Customer list modal state
  const [showCustomerList, setShowCustomerList] = useState(false);
  const [allCustomers, setAllCustomers] = useState([]);

  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);

  // Check for existing login
  useEffect(() => {
    const savedToken = localStorage.getItem('agent_token');
    const savedAgent = localStorage.getItem('agent_info');
    if (savedToken && savedAgent) {
      try {
        // Validate token format and expiry
        const tokenParts = savedToken.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(atob(tokenParts[1]));
          const now = Math.floor(Date.now() / 1000);

          // Check if token is expired
          if (payload.exp && payload.exp < now) {
            console.log('Token expired, clearing storage');
            localStorage.removeItem('agent_token');
            localStorage.removeItem('agent_info');
            return;
          }
        }

        const agentData = JSON.parse(savedAgent);
        setToken(savedToken);
        setAgent(agentData);
      } catch (error) {
        // Invalid data, clear storage
        console.log('Invalid token or agent data, clearing storage');
        localStorage.removeItem('agent_token');
        localStorage.removeItem('agent_info');
      }
    }
  }, []);

  // Connect WebSocket when logged in
  useEffect(() => {
    if (agent && token) {
      connectWebSocket();
    }
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [agent, token]);

  // Mark messages as read when viewing a session
  useEffect(() => {
    if (selectedSession && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'mark_all_read',
        targetSessionId: selectedSession
      }));
    }
  }, [selectedSession]);

  const connectWebSocket = () => {
    try {
      wsRef.current = new WebSocket(WS_URL);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        // Register as agent
        wsRef.current.send(JSON.stringify({
          type: 'agent_register',
          agentId: agent.id,
          agentName: agent.name,
          token: token
        }));
      };

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        setTimeout(connectWebSocket, 3000);
      };

      wsRef.current.onerror = () => {
        console.error('WebSocket error');
      };
    } catch (error) {
      setTimeout(connectWebSocket, 3000);
    }
  };

  const handleWebSocketMessage = (data) => {
    // Handle authentication errors
    if (data.type === 'error') {
      if (data.message === 'Authentication failed' || data.message === 'Invalid token') {
        console.error('Authentication error:', data.message);
        console.log('Your session has expired. Please login again.');
        // Token is invalid, log out
        alert('Your session has expired. Please login again.');
        handleLogout();
      }
      return;
    }

    // Agent registered
    if (data.type === 'agent_registered') {
      console.log('✅ Agent registered:', data.agentName);
    }

    // Agents list updated
    if (data.type === 'agents_list_updated') {
      setOnlineAgents(data.agents);
    }

    // Unassigned sessions list (initial load - add all to allSessions)
    if (data.type === 'unassigned_sessions') {
      setAllSessions(prev => {
        const newSessions = new Map(prev);
        data.sessions.forEach(s => {
          const lastActivity = s.lastActivity ? new Date(s.lastActivity).getTime() : 0;
          const existing = newSessions.get(s.sessionId);
          newSessions.set(s.sessionId, {
            messages: existing?.messages || [],
            project: s.project,
            isOnline: s.isOnline,
            customerName: s.customerName,
            customerPhone: s.customerPhone || null,
            messageCount: s.messageCount || 0,
            lastActivity: lastActivity
          });
        });
        return newSessions;
      });
    }

    // New user connected - add to all sessions
    if (data.type === 'new_user_connected') {
      setAllSessions(prev => {
        const newSessions = new Map(prev);
        if (!newSessions.has(data.sessionId)) {
          newSessions.set(data.sessionId, {
            messages: [],
            project: data.project,
            isOnline: true,
            customerName: data.customerName,
            lastActivity: 0
          });
        } else {
          const session = newSessions.get(data.sessionId);
          newSessions.set(data.sessionId, {
            ...session,
            isOnline: true,
            customerName: data.customerName || session.customerName
          });
        }
        return newSessions;
      });
    }

    // New user message - add to the session
    if (data.type === 'new_user_message') {
      setAllSessions(prev => {
        const newSessions = new Map(prev);
        const existing = newSessions.get(data.sessionId) || {
          messages: [], project: data.project, isOnline: data.isOnline ?? true, customerInfo: data.customerInfo || null
        };

        const newMessage = !existing.messages.some(m => m.id === data.messageId)
          ? {
              id: data.messageId,
              text: data.text,
              sender: 'user',
              timestamp: new Date(data.timestamp),
              needsHumanSupport: data.needsHumanSupport,
              fileUrl: data.fileUrl,
              fileType: data.fileType,
              fileName: data.fileName
            }
          : null;

        if (newMessage) {
          if (selectedSession !== data.sessionId) {
            setUnreadCounts(prev => ({
              ...prev,
              [data.sessionId]: (prev[data.sessionId] || 0) + 1
            }));
          } else {
            setTimeout(() => {
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }, 100);
          }
        }

        newSessions.set(data.sessionId, {
          ...existing,
          isOnline: data.isOnline ?? existing.isOnline,
          lastActivity: Date.now(),
          customerInfo: data.customerInfo && !existing.customerInfo ? data.customerInfo : existing.customerInfo,
          messages: newMessage ? [...existing.messages, newMessage] : existing.messages
        });

        return newSessions;
      });
    }

    // Session assigned (just log, no need to move between lists)
    if (data.type === 'session_assigned') {
      console.log(`Session ${data.sessionId} assigned to ${data.agentName}`);
    }

    // Claim accepted
    if (data.type === 'claim_accepted') {
      console.log('✅ Session claimed:', data.sessionId);
    }

    // User typing
    if (data.type === 'user_typing') {
      setUserTyping(prev => ({ ...prev, [data.sessionId]: true }));
      if (typingTimeoutRefs.current.has(data.sessionId)) {
        clearTimeout(typingTimeoutRefs.current.get(data.sessionId));
      }
      typingTimeoutRefs.current.set(data.sessionId, setTimeout(() => {
        setUserTyping(prev => ({ ...prev, [data.sessionId]: false }));
      }, 3000));
    }

    // User disconnected
    if (data.type === 'user_disconnected') {
      setAllSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(data.sessionId);
        if (session) {
          newSessions.set(data.sessionId, { ...session, isOnline: false });
        }
        return newSessions;
      });
    }

    // Agent disconnected
    if (data.type === 'agent_disconnected') {
      console.log(`Agent ${data.agentName} disconnected`);
    }

    // Human support requested by AI
    if (data.type === 'human_support_requested') {
      setAllSessions(prev => {
        const newSessions = new Map(prev);
        if (!newSessions.has(data.sessionId)) {
          newSessions.set(data.sessionId, {
            messages: [],
            project: data.project,
            isOnline: true,
            customerName: data.customerName,
            hasNewMessage: true,
            lastActivity: Date.now()
          });
        }
        return newSessions;
      });
    }

    // Message status updates
    if (data.type === 'message_status_update') {
      setMessageStatuses(prev => ({
        ...prev,
        [data.messageId]: data.status
      }));
    }

    // All messages read by user
    if (data.type === 'all_messages_read' || data.type === 'all_messages_read_by_agent') {
      const sessionId = data.sessionId;
      setMessageStatuses(prev => {
        const updated = { ...prev };
        // Mark all existing status as read
        Object.keys(updated).forEach(id => {
          updated[id] = 'read';
        });
        // Also mark any agent messages for this session that don't have status yet
        if (sessionId && allSessions.has(sessionId)) {
          const session = allSessions.get(sessionId);
          session.messages?.forEach(msg => {
            if (msg.sender === 'agent' && !updated[msg.id]) {
              updated[msg.id] = 'read';
            }
          });
        }
        return updated;
      });
    }

    // File deleted by customer
    if (data.type === 'file_deleted') {
      const sessionId = data.sessionId;
      const messageId = data.messageId;
      console.log('🗑️ File deleted from session', sessionId, 'message', messageId);

      setAllSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(sessionId);
        if (session) {
          session.messages = session.messages.filter(m => m.id !== messageId);
          newSessions.set(sessionId, session);
        }
        return newSessions;
      });
    }

    // Agent replied (another agent sent a message)
    if (data.type === 'agent_replied') {
      // Skip if this is my own message (I already added it to UI)
      if (data.agentId === agent.id) {
        // But update the status to delivered
        setMessageStatuses(prev => ({
          ...prev,
          [data.messageId]: 'delivered'
        }));
        return;
      }

      // Add the reply to all sessions so all agents can see who responded
      setAllSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(data.sessionId);

        if (session) {
          // Check if message already exists
          const messageExists = session.messages.some(m => m.id === data.messageId);
          if (!messageExists) {
            newSessions.set(data.sessionId, {
              ...session,
              lastActivity: Date.now(),
              messages: [...session.messages, {
                id: data.messageId,
                text: data.text,
                sender: 'agent',
                timestamp: new Date(data.timestamp),
                agentName: data.agentName,
                agentId: data.agentId,
                fileUrl: data.fileUrl,
                fileType: data.fileType,
                fileName: data.fileName
              }]
            });
          }
        }
        return newSessions;
      });
    }

    // Customer info update (when customer submits form)
    if (data.type === 'customer_info_update') {
      console.log('📋 Customer info received:', data.customerInfo);

      setAllSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(data.sessionId);
        if (session) {
          newSessions.set(data.sessionId, {
            ...session,
            customerInfo: data.customerInfo
          });
        }
        return newSessions;
      });
    }
  };

  // Open/select a session
  const openSession = async (sessionId) => {
    // Select this session
    setSelectedSession(sessionId);
    setShowSidebar(false);

    // Notify backend that we're viewing this session (for AI stopping)
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'agent_claim_session',
        sessionId,
        agentId: agent.id
      }));
    }

    // Load history and customer info
    const session = allSessions.get(sessionId);
    try {
      // Always fetch customer info (even if messages already loaded)
      const customerResponse = await fetch(`${API_URL}/api/chat/customer/${sessionId}`);
      const customerData = await customerResponse.json();
      if (customerData.success && customerData.customer) {
        const customer = customerData.customer;
        setAllSessions(prev => {
          const newSessions = new Map(prev);
          const sess = newSessions.get(sessionId);
          if (sess) {
            newSessions.set(sessionId, {
              ...sess,
              customerInfo: {
                customerId: customer.customer_id,
                fullName: customer.full_name,
                email: customer.email,
                phone: customer.phone,
                ipAddress: customer.ip_address,
                country: customer.country,
                isVpn: customer.is_vpn,
                vpnProvider: customer.vpn_provider
              }
            });
          }
          return newSessions;
        });
      }

      // Load message history only if not already loaded
      if (!session || session.messages.length === 0) {
        const response = await fetch(`${API_URL}/api/contact/user-messages/${sessionId}`);
        const data = await response.json();
        if (data.success && data.messages.length > 0) {
          const history = [];
          const seenIds = new Set();

          data.messages.forEach(msg => {
            if (seenIds.has(msg.id)) return;
            seenIds.add(msg.id);

            history.push({
              id: msg.id,
              text: msg.text,
              sender: 'user',
              timestamp: new Date(msg.timestamp),
              fileUrl: msg.fileUrl,
              fileType: msg.fileType,
              fileName: msg.fileName
            });

            msg.replies?.forEach(reply => {
              const replyId = `reply_${reply.id}`;
              if (seenIds.has(replyId)) return;
              seenIds.add(replyId);

              history.push({
                id: replyId,
                text: reply.text,
                sender: 'agent',
                timestamp: new Date(reply.timestamp),
                agentName: reply.admin,
                fileUrl: reply.fileUrl,
                fileType: reply.fileType,
                fileName: reply.fileName
              });
            });
          });

          setAllSessions(prev => {
            const newSessions = new Map(prev);
            const sess = newSessions.get(sessionId);
            if (sess) {
              newSessions.set(sessionId, { ...sess, messages: history });
            }
            return newSessions;
          });
        }
      }
    } catch (error) {
      console.error('Error loading session data:', error);
    }

    // Clear unread count for this session
    setUnreadCounts(prev => {
      const updated = { ...prev };
      delete updated[sessionId];
      return updated;
    });
  };

  // Handle file upload
  const handleFileUpload = async (file) => {
    if (!file) return null;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      if (result.success) {
        return result.file;
      } else {
        alert('File upload failed: ' + result.error);
        return null;
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('File upload failed');
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    console.log(`📎 Agent selected ${files.length} file(s):`, files.map(f => f.name));
    if (files.length > 0) {
      // Add to existing files instead of replacing
      setSelectedFiles(prev => {
        const updated = [...prev, ...files];
        console.log(`📦 Agent total files now: ${updated.length}`, updated.map(f => f.name));
        return updated;
      });
    }
    // Reset input to allow selecting same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Remove file from selection
  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
  };

  // Delete uploaded file from server and messages
  const deleteFile = async (sessionId, msg) => {
    try {
      // Extract filename from URL
      const filename = msg.fileUrl.split('/').pop();

      // Delete from server
      await fetch(`http://localhost:5003/api/upload/${filename}`, {
        method: 'DELETE'
      });

      // Remove from messages in the session
      setAllSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(sessionId);
        if (session) {
          session.messages = session.messages.filter(m => m.id !== msg.id);
          newSessions.set(sessionId, session);
        }
        return newSessions;
      });

      // Notify customer via WebSocket that file was deleted
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'file_deleted',
          sessionId: sessionId,
          messageId: msg.id
        }));
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      // Still remove from UI even if server delete fails
      setAllSessions(prev => {
        const newSessions = new Map(prev);
        const session = newSessions.get(sessionId);
        if (session) {
          session.messages = session.messages.filter(m => m.id !== msg.id);
          newSessions.set(sessionId, session);
        }
        return newSessions;
      });
    }
  };

  // Send selected files
  const sendSelectedFiles = async () => {
    if (selectedFiles.length === 0) return;

    setIsUploading(true);
    const filesToSend = [...selectedFiles];
    setSelectedFiles([]);

    for (const file of filesToSend) {
      const uploadedFile = await handleFileUpload(file);
      if (uploadedFile) {
        await sendFileMessage(uploadedFile);
      }
    }

    setIsUploading(false);
  };

  // Send file as message
  const sendFileMessage = async (file) => {
    if (!selectedSession) return;

    const messageId = `agent_${agent.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const session = allSessions.get(selectedSession);
    const lastUserMessage = session?.messages?.slice().reverse().find(m => m.sender === 'user');

    try {
      // Save to database
      if (lastUserMessage) {
        await fetch(`${API_URL}/api/contact/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId: lastUserMessage.id,
            reply: '',
            email: `${selectedSession}@chat.local`,
            userId: selectedSession,
            agentId: agent.id,
            agentName: agent.name,
            fileUrl: file.url,
            fileType: file.type,
            fileName: file.originalName
          })
        });
      }

      // Set initial status as 'sent'
      setMessageStatuses(prev => ({
        ...prev,
        [messageId]: 'sent'
      }));

      // Add to UI
      setAllSessions(prev => {
        const newSessions = new Map(prev);
        const sess = newSessions.get(selectedSession);
        if (sess) {
          if (!sess.messages.some(m => m.id === messageId)) {
            newSessions.set(selectedSession, {
              ...sess,
              messages: [...sess.messages, {
                id: messageId,
                text: '',
                sender: 'agent',
                timestamp: new Date(),
                agentName: agent.name,
                fileUrl: file.url,
                fileType: file.type,
                fileName: file.originalName
              }]
            });
          }
        }
        return newSessions;
      });

      // Send via WebSocket
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'agent_message',
          text: '',
          messageId: messageId,
          sessionId: selectedSession,
          agentId: agent.id,
          agentName: agent.name,
          fileUrl: file.url,
          fileType: file.type,
          fileName: file.originalName
        }));

        // Mark all user messages as read since agent is responding
        wsRef.current.send(JSON.stringify({
          type: 'mark_all_read',
          targetSessionId: selectedSession
        }));
      }
    } catch (error) {
      console.error('Error sending file message:', error);
    }
  };

  // Send reply
  const sendReply = async (e) => {
    e.preventDefault();
    if (!replyText.trim() || !selectedSession) return;

    const message = replyText;
    const messageId = `agent_${agent.id}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    setReplyText('');

    // Get last message ID for database
    const session = allSessions.get(selectedSession);
    const lastUserMessage = session?.messages?.slice().reverse().find(m => m.sender === 'user');

    try {
      // Save to database
      if (lastUserMessage) {
        // Extract numeric ID if it has prefix (e.g., "db_user_107" -> "107")
        let dbMessageId = lastUserMessage.id;
        if (typeof dbMessageId === 'string' && dbMessageId.includes('_')) {
          const parts = dbMessageId.split('_');
          dbMessageId = parts[parts.length - 1];
        }

        await fetch(`${API_URL}/api/contact/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId: dbMessageId,
            reply: message,
            email: `${selectedSession}@chat.local`,
            userId: selectedSession,
            agentId: agent.id,
            agentName: agent.name
          })
        });
      }

      // Set initial status as 'sent'
      setMessageStatuses(prev => ({
        ...prev,
        [messageId]: 'sent'
      }));

      // Add to UI
      setAllSessions(prev => {
        const newSessions = new Map(prev);
        const sess = newSessions.get(selectedSession);
        if (sess) {
          // Check if message already exists to prevent duplicates
          if (!sess.messages.some(m => m.id === messageId)) {
            newSessions.set(selectedSession, {
              ...sess,
              messages: [...sess.messages, {
                id: messageId,
                text: message,
                sender: 'agent',
                timestamp: new Date(),
                agentName: agent.name
              }]
            });
          }
        }
        return newSessions;
      });

      // Send via WebSocket for real-time delivery
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'agent_message',
          text: message,
          messageId: messageId,
          sessionId: selectedSession,
          agentId: agent.id,
          agentName: agent.name,
          timestamp: new Date().toISOString()
        }));

        // Mark all user messages as read since agent is responding
        wsRef.current.send(JSON.stringify({
          type: 'mark_all_read',
          targetSessionId: selectedSession
        }));
      }

      // Auto-scroll to bottom after sending message
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (error) {
      console.error('Error sending reply:', error);
    }
  };

  // Send typing event
  const sendTypingEvent = (sessionId) => {
    const now = Date.now();
    if (now - (lastTypingRef.current.get(sessionId) || 0) > 2000) {
      lastTypingRef.current.set(sessionId, now);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: 'typing',
          isTyping: true,
          targetSessionId: sessionId
        }));
      }
    }
  };

  // Change agent status
  const changeStatus = (newStatus) => {
    setAgentStatus(newStatus);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'agent_status_change',
        agentId: agent.id,
        status: newStatus
      }));
    }
  };

  // Fetch all customers
  const fetchAllCustomers = async () => {
    try {
      const response = await fetch(`${API_URL}/api/chat/customers/all`);
      const data = await response.json();
      if (data.success) {
        setAllCustomers(data.customers);
        setShowCustomerList(true);
      }
    } catch (error) {
      console.error('Error fetching customers:', error);
    }
  };

  // Export to Excel
  const exportToExcel = () => {
    if (allCustomers.length === 0) return;

    // Create CSV content
    const headers = ['Full Name', 'Email', 'Phone', 'Country', 'IP Address', 'Session ID', 'Created At'];
    const rows = allCustomers.map(c => [
      c.full_name || '',
      c.email || '',
      c.phone || '',
      c.country || '',
      c.ip_address || '',
      c.session_id || '',
      new Date(c.created_at).toLocaleString()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `customers_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Logout
  const handleLogout = () => {
    localStorage.removeItem('agent_token');
    localStorage.removeItem('agent_info');
    if (wsRef.current) {
      wsRef.current.close();
    }
    setAgent(null);
    setToken(null);
  };

  // Login handler
  const handleLogin = (agentData, tokenData) => {
    setAgent(agentData);
    setToken(tokenData);
  };

  // Show login if not authenticated
  if (!agent) {
    return <AgentLogin onLogin={handleLogin} />;
  }

  const selectedSessionData = selectedSession ? allSessions.get(selectedSession) : null;

  return (
    <div className="h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex flex-col md:flex-row overflow-hidden">
      {/* Mobile Sidebar Overlay */}
      {showSidebar && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed md:relative inset-y-0 left-0 z-50
        w-80 md:w-80 bg-gray-900/50 border-r border-gray-700
        flex flex-col h-full overflow-y-auto
        transform transition-transform duration-300 ease-in-out
        ${showSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Agent Info */}
        <div className="p-3 md:p-4 border-b border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 md:gap-3">
              <div className="w-8 h-8 md:w-10 md:h-10 bg-purple-500/20 rounded-full flex items-center justify-center">
                <User size={16} className="text-purple-400 md:w-5 md:h-5" />
              </div>
              <div>
                <p className="text-white font-medium text-sm md:text-base">{agent.name}</p>
                <p className="text-gray-500 text-[10px] md:text-xs">{agent.role}</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 md:gap-2">
              <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`}></div>
              <button
                onClick={handleLogout}
                className="p-1.5 md:p-2 hover:bg-gray-700 rounded-lg text-gray-400 hover:text-white"
                title="Logout"
              >
                <LogOut size={16} className="md:w-[18px] md:h-[18px]" />
              </button>
            </div>
          </div>

          {/* Status selector */}
          <div className="mt-2 md:mt-3 flex gap-1.5 md:gap-2">
            {['online', 'away', 'busy'].map(status => (
              <button
                key={status}
                onClick={() => changeStatus(status)}
                className={`flex-1 py-1 md:py-1.5 rounded text-[10px] md:text-xs capitalize ${
                  agentStatus === status
                    ? status === 'online' ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                      : status === 'away' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50'
                      : 'bg-red-500/20 text-red-400 border border-red-500/50'
                    : 'bg-gray-800 text-gray-500 border border-gray-700'
                }`}
              >
                {status}
              </button>
            ))}
          </div>
        </div>

        {/* Online Agents */}
        <div className="p-2 md:p-3 border-b border-gray-700">
          <div className="flex items-center gap-1.5 md:gap-2 text-gray-400 text-[10px] md:text-xs mb-1.5 md:mb-2">
            <Users size={12} className="md:w-3.5 md:h-3.5" />
            <span>Online Agents ({onlineAgents.length})</span>
          </div>
          <div className="flex flex-wrap gap-1.5 md:gap-2">
            {onlineAgents.map(a => (
              <div
                key={a.id}
                className={`px-1.5 md:px-2 py-0.5 md:py-1 rounded text-[10px] md:text-xs flex items-center gap-1 ${
                  a.id === agent.id ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-800 text-gray-400'
                }`}
              >
                <Circle size={6} className={`md:w-2 md:h-2 ${
                  a.status === 'online' ? 'fill-green-400 text-green-400'
                    : a.status === 'away' ? 'fill-yellow-400 text-yellow-400'
                    : 'fill-red-400 text-red-400'
                }`} />
                <span className="hidden sm:inline">{a.name}</span>
                <span className="sm:hidden">{a.name.split(' ')[0]}</span>
                {a.assignedCount > 0 && (
                  <span className="bg-gray-700 px-1 rounded text-[9px] md:text-[10px]">{a.assignedCount}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Customer List Button */}
        <div className="p-2 md:p-3 border-b border-gray-700">
          <button
            onClick={fetchAllCustomers}
            className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold py-2 md:py-2.5 rounded-lg transition-all flex items-center justify-center gap-2 text-xs md:text-sm"
          >
            <UserCircle size={16} className="md:w-4 md:h-4" />
            Customer List
          </button>
        </div>

        {/* All Sessions */}
        <div className="flex-1 overflow-y-auto p-2 md:p-3">
          <div className="flex items-center gap-1.5 md:gap-2 text-gray-400 text-[10px] md:text-xs mb-1.5 md:mb-2">
            <MessageCircle size={12} className="md:w-3.5 md:h-3.5" />
            <span>All Chats ({allSessions.size})</span>
          </div>
          <div className="space-y-1.5 md:space-y-2">
            {Array.from(allSessions.entries()).sort((a, b) => (b[1].lastActivity || 0) - (a[1].lastActivity || 0)).map(([sessionId, session]) => (
              <div
                key={sessionId}
                onClick={() => {
                  openSession(sessionId);
                }}
                className={`p-2 md:p-3 rounded-lg cursor-pointer transition ${
                  selectedSession === sessionId
                    ? 'bg-purple-500/20 border border-purple-500/50'
                    : 'bg-gray-800/50 border border-gray-700 hover:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 md:gap-2">
                  <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full flex-shrink-0 ${session.isOnline ? 'bg-green-400 animate-pulse' : 'bg-gray-500'}`}></div>
                      <span className="text-white text-xs md:text-sm truncate">
                        {session.customerName || session.customerInfo?.fullName || sessionId.split('_')[1]?.substring(0, 8) + '...'}
                      </span>
                    </div>
                    {(session.customerInfo?.phone || session.customerPhone) && (
                      <span className="text-gray-400 text-[9px] md:text-[10px] ml-4 md:ml-5 truncate">
                        {session.customerInfo?.phone || session.customerPhone}
                      </span>
                    )}
                  </div>
                  {unreadCounts[sessionId] > 0 && (
                    <div className="bg-red-500 text-white text-[9px] md:text-[10px] font-bold rounded-full min-w-[16px] md:min-w-[18px] h-4 md:h-[18px] flex items-center justify-center px-1">
                      {unreadCounts[sessionId]}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5 md:gap-2 mt-0.5 md:mt-1 flex-wrap">
                  <span className="text-gray-500 text-[10px] md:text-xs flex items-center gap-0.5 md:gap-1">
                    <Globe size={8} className="md:w-2.5 md:h-2.5" />
                    <span className="hidden sm:inline">{session.project}</span>
                  </span>
                  <span className="text-gray-500 text-[10px] md:text-xs">
                    {session.messages?.length || session.messageCount || 0} msg
                  </span>
                  {userTyping[sessionId] && (
                    <span className="text-purple-400 text-[10px] md:text-xs animate-pulse">typing...</span>
                  )}
                </div>
              </div>
            ))}
            {allSessions.size === 0 && (
              <p className="text-gray-600 text-[10px] md:text-xs text-center py-3 md:py-4">
                No chats yet. Waiting for customers...
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {selectedSession && selectedSessionData ? (
          <>
            {/* Chat Header */}
            <div className="p-2 md:p-4 border-b border-gray-700 bg-gray-900/30">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 md:gap-0">
                {/* Mobile menu button */}
                <button
                  onClick={() => setShowSidebar(true)}
                  className="md:hidden absolute top-3 left-3 p-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400"
                >
                  <Menu size={20} />
                </button>

                <div className="flex items-center gap-2 md:gap-3 flex-1 ml-12 md:ml-0">
                  <div className="w-8 h-8 md:w-10 md:h-10 bg-gray-700 rounded-full flex items-center justify-center flex-shrink-0">
                    <User size={16} className="text-gray-400 md:w-5 md:h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium text-sm md:text-base truncate">
                      {selectedSessionData.customerInfo?.fullName || selectedSessionData.customerName || selectedSession.split('_')[1]?.substring(0, 12) + '...'}
                    </p>
                    <div className="flex items-center gap-1 md:gap-2 flex-wrap">
                      <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${selectedSessionData.isOnline ? 'bg-green-400' : 'bg-gray-500'}`}></div>
                      <span className="text-gray-400 text-xs md:text-sm">
                        {selectedSessionData.isOnline ? 'Online' : 'Offline'}
                      </span>
                      <span className="text-gray-600 hidden sm:inline">•</span>
                      <span className="text-gray-400 text-xs md:text-sm hidden sm:inline">{selectedSessionData.project}</span>
                    </div>
                  </div>
                </div>
                {(selectedSessionData.customerInfo || selectedSessionData.customerName || selectedSessionData.customerPhone) && (
                  <div className="bg-gray-800/50 border border-gray-700 rounded-lg px-2 md:px-3 py-1.5 md:py-2 text-[10px] md:text-xs space-y-0.5 md:space-y-1 w-full md:w-auto">
                    <div className="text-gray-400">
                      <span className="text-gray-500">Name:</span> <span className="text-white">{selectedSessionData.customerInfo?.fullName || selectedSessionData.customerName || '-'}</span>
                    </div>
                    {(selectedSessionData.customerInfo?.email) && (
                    <div className="text-gray-400">
                      <span className="text-gray-500">Email:</span> {selectedSessionData.customerInfo.email}
                    </div>
                    )}
                    <div className="text-gray-400">
                      <span className="text-gray-500">Phone:</span> {selectedSessionData.customerInfo?.phone || selectedSessionData.customerPhone || '-'}
                    </div>
                    {selectedSessionData.customerInfo?.country && selectedSessionData.customerInfo.country !== 'Unknown' && (
                      <div className="text-gray-400 flex items-center gap-1">
                        <Globe size={12} className="text-blue-400" />
                        <span className="text-gray-500">Location:</span> <span className="text-blue-400">{selectedSessionData.customerInfo.country}</span>
                      </div>
                    )}
                    {selectedSessionData.customerInfo?.ipAddress && selectedSessionData.customerInfo.ipAddress !== 'Unknown' && (
                      <div className="text-gray-400">
                        <span className="text-gray-500">IP:</span> <span className="text-green-400 font-mono">{selectedSessionData.customerInfo.ipAddress}</span>
                      </div>
                    )}
                    {selectedSessionData.customerInfo?.isVpn && (
                      <div className="bg-red-500/20 border border-red-500/50 rounded px-2 py-1 flex items-center gap-1.5">
                        <ShieldAlert size={14} className="text-red-400 md:w-4 md:h-4" />
                        <span className="text-red-400 font-semibold">VPN/Proxy Detected</span>
                        {selectedSessionData.customerInfo?.vpnProvider && (
                          <span className="text-red-300 text-[9px] md:text-[10px]">({selectedSessionData.customerInfo.vpnProvider})</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-2 md:p-4 space-y-2 md:space-y-3">
              {selectedSessionData.messages?.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.sender === 'user' ? 'justify-start' : 'justify-end'}`}
                >
                  <div
                    className={`max-w-[85%] md:max-w-[70%] rounded-lg px-3 py-1.5 md:px-4 md:py-2 ${
                      msg.sender === 'user'
                        ? 'bg-gray-700 text-white'
                        : 'bg-gray-800 text-gray-200 border border-gray-600'
                    }`}
                  >
                    {msg.agentName && (
                      <p className="text-[10px] md:text-xs text-purple-400 mb-0.5 md:mb-1">{msg.agentName}</p>
                    )}

                    {/* File attachment */}
                    {msg.fileUrl && (
                      <div className="mb-2 relative group">
                        {msg.fileType === 'image' && (
                          <div className="relative">
                            <img
                              src={msg.fileUrl}
                              alt={msg.fileName}
                              className="max-w-full rounded-lg max-h-64 object-cover cursor-pointer hover:opacity-90 transition"
                              onClick={() => setSelectedImage(msg.fileUrl)}
                            />
                            {msg.sender === 'agent' && (
                              <button
                                onClick={() => deleteFile(selectedSession, msg)}
                                className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Sil"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        )}
                        {msg.fileType === 'video' && (
                          <div className="relative">
                            <video controls className="max-w-full rounded-lg max-h-64">
                              <source src={msg.fileUrl} />
                            </video>
                            {msg.sender === 'agent' && (
                              <button
                                onClick={() => deleteFile(selectedSession, msg)}
                                className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Sil"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        )}
                        {msg.fileType === 'application' && (
                          <div className="flex items-center gap-2">
                            <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm underline">
                              <File size={16} />
                              {msg.fileName}
                            </a>
                            {msg.sender === 'agent' && (
                              <button
                                onClick={() => deleteFile(selectedSession, msg)}
                                className="bg-red-500 hover:bg-red-600 text-white rounded-full p-1"
                                title="Sil"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Only show text if it's not empty and not a file placeholder */}
                    {msg.text && msg.text.trim() !== '' && !msg.text.startsWith('[File:') && (
                      <p className="text-xs md:text-sm">{msg.text}</p>
                    )}
                    <div className="flex items-center justify-end gap-0.5 md:gap-1 mt-0.5 md:mt-1">
                      <p className="text-[9px] md:text-[10px] opacity-60">
                        {new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                      {/* WhatsApp-style status ticks for agent messages */}
                      {msg.sender === 'agent' && (
                        <span className="ml-0.5 md:ml-1">
                          {messageStatuses[msg.id] === 'read' ? (
                            <CheckCheck size={10} className="text-blue-400 md:w-3 md:h-3" />
                          ) : messageStatuses[msg.id] === 'delivered' ? (
                            <CheckCheck size={10} className="text-gray-400 md:w-3 md:h-3" />
                          ) : (
                            <Check size={10} className="text-gray-400 md:w-3 md:h-3" />
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {userTyping[selectedSession] && (
                <div className="flex justify-start">
                  <div className="bg-gray-700 rounded-lg px-3 py-1.5 md:px-4 md:py-2">
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <div className="flex gap-0.5 md:gap-1">
                        <span className="w-1 h-1 md:w-1.5 md:h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                        <span className="w-1 h-1 md:w-1.5 md:h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                        <span className="w-1 h-1 md:w-1.5 md:h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      </div>
                      <span className="text-gray-400 text-[10px] md:text-xs">typing...</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Scroll anchor */}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply Input */}
            <form onSubmit={sendReply} className="p-2 md:p-4 border-t border-gray-700 bg-gray-900/30">
              {/* Selected files preview */}
              {selectedFiles.length > 0 && (
                <div className="mb-2 md:mb-3 flex flex-wrap gap-1.5 md:gap-2">
                  {selectedFiles.map((file, index) => (
                    <div key={index} className="bg-gray-800/50 border border-gray-700 rounded-lg p-1.5 md:p-2 flex items-center gap-1.5 md:gap-2">
                      {file.type.startsWith('image/') ? (
                        <Image size={14} className="text-purple-400 md:w-4 md:h-4" />
                      ) : file.type.startsWith('video/') ? (
                        <Video size={14} className="text-purple-400 md:w-4 md:h-4" />
                      ) : (
                        <File size={14} className="text-purple-400 md:w-4 md:h-4" />
                      )}
                      <span className="text-white text-[10px] md:text-xs">{file.name.length > 15 ? file.name.substring(0, 15) + '...' : file.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="text-red-400 hover:text-red-300"
                      >
                        <X size={12} className="md:w-3.5 md:h-3.5" />
                      </button>
                    </div>
                  ))}
                  {/* Send files button */}
                  <button
                    type="button"
                    onClick={sendSelectedFiles}
                    disabled={isUploading}
                    className="bg-purple-500/20 border border-purple-500/50 text-purple-400 px-2 md:px-3 py-1.5 md:py-2 rounded-lg hover:bg-purple-500/30 disabled:opacity-50 text-[10px] md:text-xs"
                  >
                    {isUploading ? 'Uploading...' : `Send ${selectedFiles.length}`}
                  </button>
                </div>
              )}

              <div className="flex gap-2 md:gap-3">
                {/* File input (hidden) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*,.pdf,.doc,.docx,.txt"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {/* Attachment button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className="bg-gray-800/50 border border-gray-700 text-purple-400 px-2 py-2 md:px-3 md:py-3 rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  title="Attach file"
                >
                  {isUploading ? (
                    <div className="w-3.5 h-3.5 md:w-4 md:h-4 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Paperclip size={16} className="md:w-[18px] md:h-[18px]" />
                  )}
                </button>

                <input
                  type="text"
                  value={replyText}
                  onChange={(e) => {
                    setReplyText(e.target.value);
                    sendTypingEvent(selectedSession);
                  }}
                  className="flex-1 bg-gray-800/50 border border-gray-700 text-white px-3 py-2 md:px-4 md:py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm md:text-base"
                  placeholder="Type your reply..."
                />
                <button
                  type="submit"
                  disabled={!replyText.trim()}
                  className="bg-purple-500 hover:bg-purple-600 disabled:opacity-50 text-white px-4 py-2 md:px-6 md:py-3 rounded-lg flex items-center gap-1.5 md:gap-2"
                >
                  <Send size={16} className="md:w-[18px] md:h-[18px]" />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center p-4 relative">
            {/* Mobile menu button when no chat selected */}
            <button
              onClick={() => setShowSidebar(true)}
              className="md:hidden absolute top-3 left-3 p-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-gray-400"
            >
              <Menu size={20} />
            </button>

            <div className="text-center">
              <MessageCircle size={32} className="text-gray-700 mx-auto mb-3 md:w-12 md:h-12 md:mb-4" />
              <p className="text-gray-500 text-sm md:text-base">Select a chat or claim one from waiting list</p>
            </div>
          </div>
        )}
      </div>

      {/* Image Lightbox Modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedImage(null)}
        >
          <button
            onClick={() => setSelectedImage(null)}
            className="absolute top-4 right-4 text-white bg-gray-800/50 hover:bg-gray-700 rounded-full p-2 transition"
          >
            <X size={24} />
          </button>
          <img
            src={selectedImage}
            alt="Full size"
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Customer List Modal */}
      {showCustomerList && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setShowCustomerList(false)}
        >
          <div
            className="bg-gray-800 border border-gray-700 rounded-2xl max-w-6xl w-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="p-4 md:p-6 border-b border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <UserCircle size={24} className="text-purple-400" />
                <div>
                  <h2 className="text-xl md:text-2xl font-bold text-white">Customer List</h2>
                  <p className="text-gray-400 text-sm">Total: {allCustomers.length} customers</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={exportToExcel}
                  className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition text-sm md:text-base"
                >
                  <Download size={18} />
                  Export Excel
                </button>
                <button
                  onClick={() => setShowCustomerList(false)}
                  className="text-gray-400 hover:text-white bg-gray-700 hover:bg-gray-600 rounded-full p-2 transition"
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto p-4 md:p-6">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-gray-400 uppercase bg-gray-900/50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3">Full Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Phone</th>
                    <th className="px-4 py-3">Country</th>
                    <th className="px-4 py-3">IP Address</th>
                    <th className="px-4 py-3">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {allCustomers.map((customer, index) => (
                    <tr
                      key={index}
                      className="border-b border-gray-700 hover:bg-gray-700/30 transition"
                    >
                      <td className="px-4 py-3 text-white font-medium">
                        {customer.full_name || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        {customer.email || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-300 font-mono">
                        {customer.phone || '-'}
                      </td>
                      <td className="px-4 py-3 text-blue-400">
                        {customer.country || '-'}
                      </td>
                      <td className="px-4 py-3 text-green-400 font-mono text-xs">
                        {customer.ip_address || '-'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">
                        {new Date(customer.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {allCustomers.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  No customers found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AgentDashboard;
