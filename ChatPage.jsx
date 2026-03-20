import { useState, useRef, useEffect } from "react";
import {
  MessageCircle,
  Send,
  ArrowLeft,
  User,
  Mail,
  Phone,
  X,
  AlertTriangle,
  Check,
  CheckCheck,
  Paperclip,
  Image,
  Video,
  File,
} from "lucide-react";

// Configure this for each project
const PROJECT_NAME = "WhiteLabel";
const API_URL =
  window.location.hostname === "localhost" ? "http://localhost:5003" : "";
const WS_URL =
  window.location.hostname === "localhost"
    ? "ws://localhost:5004"
    : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.hostname}/ws`;

/**
 * Full-Screen Chat Page
 * Customer chat interface with form capture
 */
function ChatPage({ onBack }) {
  const [messages, setMessages] = useState([
    {
      id: "system_welcome",
      text: "Hello! How can we help you today?",
      sender: "system",
      timestamp: new Date(),
    },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockReason, setBlockReason] = useState("");
  const [rateLimitError, setRateLimitError] = useState("");

  // Device ID for tracking
  const [deviceId, setDeviceId] = useState(null);

  // Customer form states
  const [showForm, setShowForm] = useState(false);
  const [formSubmitted, setFormSubmitted] = useState(false);
  const [customerInfo, setCustomerInfo] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    countryCode: "+44", // Default: UK
  });
  const [agentMessageCount, setAgentMessageCount] = useState(0);
  const [userMessageCount, setUserMessageCount] = useState(0);
  const [customerId, setCustomerId] = useState(null);
  const [formError, setFormError] = useState("");

  // Flag for marking all messages as read
  const [shouldMarkAllRead, setShouldMarkAllRead] = useState(false);

  // WhatsApp-style message status states
  const [messageStatuses, setMessageStatuses] = useState({}); // { messageId: 'sent' | 'delivered' | 'read' }
  const [adminTyping, setAdminTyping] = useState(false);
  const [adminOnline, setAdminOnline] = useState(false);
  const typingTimeoutRef = useRef(null);
  const lastTypingRef = useRef(0);

  // File upload states
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Image zoom modal state
  const [selectedImage, setSelectedImage] = useState(null);

  // Session management
  const [sessionId] = useState(() => {
    const stored = localStorage.getItem("chat_session_id");
    if (stored) return stored;
    const newId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem("chat_session_id", newId);
    return newId;
  });

  // Get device ID on mount
  useEffect(() => {
    const getDeviceId = async () => {
      try {
        const response = await fetch(`${API_URL}/api/chat/device`, {
          credentials: "include",
        });
        const data = await response.json();
        if (data.success) {
          setDeviceId(data.deviceId);
          // Also store in localStorage as fallback
          localStorage.setItem("chat_device_id", data.deviceId);
        }
      } catch (error) {
        // Fallback to localStorage
        const stored = localStorage.getItem("chat_device_id");
        if (stored) {
          setDeviceId(stored);
        }
      }
    };
    getDeviceId();
  }, []);

  // Check if form was already submitted
  useEffect(() => {
    const savedCustomerId = localStorage.getItem("chat_customer_id");
    const savedFormSubmitted = localStorage.getItem("chat_form_submitted");
    if (savedCustomerId && savedFormSubmitted === "true") {
      setCustomerId(savedCustomerId);
      setFormSubmitted(true);
    }
  }, []);

  // Security check helper
  const checkSecurity = async (eventType) => {
    try {
      const response = await fetch(`${API_URL}/api/chat/security-log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          sessionId,
          deviceId: deviceId || localStorage.getItem("chat_device_id"),
          eventType,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 403) {
          setIsBlocked(true);
          setBlockReason(data.reason || "Access denied");
          return false;
        }
        if (response.status === 429) {
          setRateLimitError(data.error);
          setTimeout(() => setRateLimitError(""), 5000);
          return false;
        }
      }

      return data.success;
    } catch (error) {
      console.error("Security check error:", error);
      return true; // Allow on error to prevent blocking legitimate users
    }
  };

  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);
  const historyLoadedRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // Kullanıcı yazıyor eventi gönder (throttled)
  const sendTypingEvent = () => {
    const now = Date.now();
    if (now - lastTypingRef.current > 2000) {
      // 2 saniyede bir gönder
      lastTypingRef.current = now;
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "typing",
            isTyping: true,
          }),
        );
      }
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Show form after first user message
  useEffect(() => {
    if (!formSubmitted && userMessageCount >= 1 && !showForm) {
      // Small delay before showing form
      const timer = setTimeout(() => {
        setShowForm(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [userMessageCount, formSubmitted, showForm]);

  // Load message history
  const loadMessageHistory = async () => {
    if (historyLoadedRef.current) return;

    try {
      setIsLoadingHistory(true);
      const response = await fetch(
        `${API_URL}/api/contact/user-messages/${sessionId}`,
      );
      const data = await response.json();

      if (data.success && data.messages.length > 0) {
        const loadedMessages = [
          {
            id: "system_welcome",
            text: "Hello! How can we help you today?",
            sender: "system",
            timestamp: new Date(),
          },
        ];

        let adminCount = 0;
        let userCount = 0;
        const seenIds = new Set();

        data.messages.forEach((msg) => {
          // Skip if we've already added this message
          if (seenIds.has(msg.id)) return;
          seenIds.add(msg.id);

          userCount++;
          loadedMessages.push({
            id: msg.id,
            text: msg.text,
            sender: "user",
            timestamp: new Date(msg.timestamp),
            fileUrl: msg.fileUrl,
            fileType: msg.fileType,
            fileName: msg.fileName,
          });

          msg.replies.forEach((reply) => {
            // Use unique ID for replies to avoid collision with message IDs
            const replyId = `reply_${reply.id}`;
            if (seenIds.has(replyId)) return;
            seenIds.add(replyId);

            adminCount++;
            loadedMessages.push({
              id: replyId,
              text: reply.text,
              sender: "system",
              timestamp: new Date(reply.timestamp),
              adminName: reply.admin,
              fileUrl: reply.fileUrl,
              fileType: reply.fileType,
              fileName: reply.fileName,
            });
          });
        });

        setMessages(loadedMessages);
        setAgentMessageCount(adminCount);
        setUserMessageCount(userCount);
        historyLoadedRef.current = true;
      }
    } catch (error) {
      console.error("Error loading message history:", error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  useEffect(() => {
    loadMessageHistory();
  }, []);

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        wsRef.current = new WebSocket(WS_URL);

        wsRef.current.onopen = () => {
          console.log("WebSocket connected");
          setIsConnected(true);
          wsRef.current.send(
            JSON.stringify({
              type: "register",
              sessionId: sessionId,
              clientType: "user",
              project: PROJECT_NAME,
            }),
          );
        };

        wsRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            if (data.type === "admin_message") {
              const adminMessage = {
                id:
                  data.messageId ||
                  `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                text: data.text,
                sender: "system",
                timestamp: new Date(data.timestamp),
                adminName: data.adminName,
                fileUrl: data.fileUrl,
                fileType: data.fileType,
                fileName: data.fileName,
              };
              setMessages((prev) => {
                // Check if message already exists
                if (prev.some((m) => m.id === adminMessage.id)) {
                  return prev;
                }
                return [...prev, adminMessage];
              });
              setAgentMessageCount((prev) => prev + 1);
              setAdminTyping(false); // Admin mesaj gönderdiğinde typing durur

              // Admin mesaj gönderdiğinde tüm mesajları okundu olarak işaretle
              if (
                wsRef.current &&
                wsRef.current.readyState === WebSocket.OPEN
              ) {
                wsRef.current.send(
                  JSON.stringify({
                    type: "mark_all_read",
                    sessionId: sessionId,
                  }),
                );
              }
            }

            // Admin typing indicator
            if (data.type === "admin_typing") {
              setAdminTyping(true);
              // 3 saniye sonra typing'i kaldır
              if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
              }
              typingTimeoutRef.current = setTimeout(() => {
                setAdminTyping(false);
              }, 3000);
            }

            // Admin online durumu
            if (data.type === "admin_online") {
              setAdminOnline(data.online);
            }

            // Mesaj durumu güncellemeleri
            if (data.type === "message_status_update") {
              setMessageStatuses((prev) => ({
                ...prev,
                [data.messageId]: data.status,
              }));
            }

            // Tüm mesajlar okundu
            if (
              data.type === "all_messages_read" ||
              data.type === "all_messages_read_by_agent"
            ) {
              setShouldMarkAllRead(true);
            }

            // File deleted by agent
            if (data.type === "file_deleted") {
              console.log("🗑️ File deleted, removing message:", data.messageId);
              setMessages((prev) =>
                prev.filter((m) => m.id !== data.messageId),
              );
            }
          } catch (error) {
            console.error("Error parsing WebSocket message:", error);
          }
        };

        wsRef.current.onclose = () => {
          console.log("WebSocket disconnected");
          setIsConnected(false);
          setTimeout(connectWebSocket, 3000);
        };

        wsRef.current.onerror = (error) => {
          console.error("WebSocket error:", error);
        };
      } catch (error) {
        console.error("WebSocket connection failed:", error);
        setTimeout(connectWebSocket, 3000);
      }
    };

    connectWebSocket();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [sessionId]);

  // Mark all user messages as read when flag is set
  useEffect(() => {
    if (shouldMarkAllRead) {
      setMessageStatuses((prev) => {
        const updated = { ...prev };
        // Mark all user messages as read
        messages.forEach((msg) => {
          if (msg.sender === "user") {
            updated[msg.id] = "read";
          }
        });
        return updated;
      });
      setShouldMarkAllRead(false);
    }
  }, [shouldMarkAllRead, messages]);

  // Handle file upload
  const handleFileUpload = async (file) => {
    if (!file) return null;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${API_URL}/api/upload`, {
        method: "POST",
        body: formData,
      });

      const result = await response.json();
      if (result.success) {
        return result.file;
      } else {
        alert("File upload failed: " + result.error);
        return null;
      }
    } catch (error) {
      console.error("Upload error:", error);
      alert("File upload failed");
      return null;
    } finally {
      setIsUploading(false);
    }
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    console.log(
      `📎 Selected ${files.length} file(s):`,
      files.map((f) => f.name),
    );
    if (files.length > 0) {
      // Add to existing files instead of replacing
      setSelectedFiles((prev) => {
        const updated = [...prev, ...files];
        console.log(
          `📦 Total files now: ${updated.length}`,
          updated.map((f) => f.name),
        );
        return updated;
      });
    }
    // Reset input to allow selecting same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Remove file from selection
  const removeFile = (index) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Delete uploaded file from server and messages
  const deleteFile = async (msg) => {
    try {
      // Extract filename from URL
      const filename = msg.fileUrl.split("/").pop();

      // Delete from server
      await fetch(`${API_URL}/api/upload/${filename}`, {
        method: "DELETE",
      });

      // Remove from messages
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));

      // Notify agent via WebSocket that file was deleted
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "file_deleted",
            sessionId: sessionId,
            messageId: msg.id,
          }),
        );
      }
    } catch (error) {
      console.error("Error deleting file:", error);
      // Still remove from UI even if server delete fails
      setMessages((prev) => prev.filter((m) => m.id !== msg.id));
    }
  };

  // Upload and send files
  const uploadAndSendFiles = async () => {
    if (selectedFiles.length === 0) return;

    // Check security/rate limit before uploading
    const allowed = await checkSecurity("message");
    if (!allowed) {
      setSelectedFiles([]);
      return;
    }

    const filesToSend = [...selectedFiles];
    setSelectedFiles([]);
    setIsUploading(true);

    try {
      // Upload files first
      const uploadedFiles = [];
      for (const file of filesToSend) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(`${API_URL}/api/upload`, {
          method: "POST",
          body: formData,
        });

        const result = await response.json();
        if (result.success) {
          uploadedFiles.push(result.file);
        }
      }

      // Send each file as separate message
      for (const file of uploadedFiles) {
        const response = await fetch(`${API_URL}/api/contact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: sessionId,
            email: `${sessionId}@chat.local`,
            message: "",
            project: PROJECT_NAME,
            deviceId: deviceId,
            fileUrl: file.url,
            fileType: file.type,
            fileName: file.originalName,
          }),
        });

        const result = await response.json();

        if (result.success && result.data) {
          const realMessageId = result.data.id;

          const newMessage = {
            id: realMessageId,
            text: "",
            sender: "user",
            timestamp: new Date(),
            fileUrl: file.url,
            fileType: file.type,
            fileName: file.originalName,
          };

          setMessages((prev) => {
            if (prev.some((m) => m.id === realMessageId)) {
              return prev;
            }
            return [...prev, newMessage];
          });
          setUserMessageCount((prev) => prev + 1);

          setMessageStatuses((prev) => ({
            ...prev,
            [realMessageId]: "sent",
          }));

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: "user_message",
                text: "",
                messageId: realMessageId,
                sessionId: sessionId,
                project: PROJECT_NAME,
                fileUrl: file.url,
                fileType: file.type,
                fileName: file.originalName,
              }),
            );
          }
        }
      }
    } catch (error) {
      console.error("Error sending files:", error);
    } finally {
      setIsUploading(false);
    }
  };

  // Handle send message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || isBlocked) return;
    if (showForm && !formSubmitted) return;

    // Check rate limit before sending
    const allowed = await checkSecurity("message");
    if (!allowed) return;

    const messageText = inputMessage;
    setInputMessage("");

    try {
      const response = await fetch(`${API_URL}/api/contact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: sessionId,
          email: `${sessionId}@chat.local`,
          message: messageText,
          project: PROJECT_NAME,
          deviceId: deviceId,
        }),
      });

      const result = await response.json();

      if (result.success && result.data) {
        const realMessageId = result.data.id;

        const newMessage = {
          id: realMessageId,
          text: messageText,
          sender: "user",
          timestamp: new Date(),
        };
        setMessages((prev) => {
          // Check if message already exists to prevent duplicates
          if (prev.some((m) => m.id === realMessageId)) {
            return prev;
          }
          return [...prev, newMessage];
        });
        setUserMessageCount((prev) => prev + 1);

        // Mesaj durumunu 'sent' olarak ayarla (1 tik)
        setMessageStatuses((prev) => ({
          ...prev,
          [realMessageId]: "sent",
        }));

        // Send via WebSocket if connected, otherwise try to reconnect
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "user_message",
              text: messageText,
              messageId: realMessageId,
              sessionId: sessionId,
              project: PROJECT_NAME,
            }),
          );
        } else {
          console.warn(
            "⚠️ WebSocket not connected, attempting to reconnect...",
          );
          // Try to reconnect and send
          connectWebSocket();
          // Queue message to send after reconnection
          setTimeout(() => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(
                JSON.stringify({
                  type: "user_message",
                  text: messageText,
                  messageId: realMessageId,
                  sessionId: sessionId,
                  project: PROJECT_NAME,
                }),
              );
            }
          }, 1000);
        }
      }
    } catch (error) {
      console.error("Error saving message:", error);
    }
  };

  // Handle form submit
  const handleFormSubmit = async (e) => {
    e.preventDefault();

    try {
      // Get real IP and country from client side
      let clientIp = "Unknown";
      let clientCountry = "Unknown";

      try {
        const ipResponse = await fetch("https://ipapi.co/json/");
        const ipData = await ipResponse.json();
        clientIp = ipData.ip || "Unknown";
        clientCountry = ipData.country_name || "Unknown";
      } catch (ipError) {
        console.log("Could not fetch IP info:", ipError);
      }

      const response = await fetch(`${API_URL}/api/chat/customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionId,
          fullName: `${customerInfo.firstName} ${customerInfo.lastName}`.trim(),
          email: customerInfo.email,
          phone: `${customerInfo.countryCode}${customerInfo.phone}`, // Combine country code + phone
          clientIp: clientIp,
          clientCountry: clientCountry,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        setFormError(result.error || "Failed to save. Please try again.");
        return;
      }

      if (result.success) {
        setFormError("");
        setCustomerId(result.customerId);
        setFormSubmitted(true);
        setShowForm(false);
        localStorage.setItem("chat_customer_id", result.customerId);
        localStorage.setItem("chat_form_submitted", "true");

        // Notify backend via WebSocket about customer info
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: "customer_info_submitted",
              sessionId: sessionId,
              customerInfo: {
                customerId: result.customerId,
                fullName: `${customerInfo.firstName} ${customerInfo.lastName}`.trim(),
                email: customerInfo.email,
                phone: `${customerInfo.countryCode}${customerInfo.phone}`,
                ipAddress: clientIp,
                country: clientCountry,
              },
            }),
          );
        }

        // Add system message about form submission
        setMessages((prev) => [
          ...prev,
          {
            id: `system_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
            text: `Thank you ${customerInfo.firstName}! Your information has been saved. An agent will assist you shortly.`,
            sender: "system",
            timestamp: new Date(),
          },
        ]);
      }
    } catch (error) {
      console.error("Error submitting customer form:", error);
    }
  };

  return (
    <div className="min-h-screen gradient-bg flex flex-col">
      <div className="w-full h-screen fixed top-0 left-0 right-0 water-mark"></div>
      {/* Header - Fixed at top */}
      <header className="sticky top-0 z-50 bg-[#300A24] p-3 md:p-4 shadow-lg border-b border-[#E95420]/30">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-4">
            {onBack && (
              <button
                onClick={onBack}
                className="text-white hover:bg-white/20 p-1.5 md:p-2 rounded-lg transition"
              >
                <ArrowLeft size={20} className="md:w-6 md:h-6" />
              </button>
            )}
            <div className="flex items-center gap-2 md:gap-3">
              <div className="bg-white/20 p-1.5 md:p-2 rounded-lg">
                <MessageCircle size={20} className="text-white md:w-7 md:h-7" />
              </div>
              <div>
                <h1 className="text-white font-bold text-base md:text-xl">
                  Customer Support
                </h1>
                <div className="flex items-center gap-1.5 md:gap-2">
                  <div
                    className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${adminOnline ? "bg-green-400 animate-pulse" : isConnected ? "bg-yellow-400" : "bg-gray-400"}`}
                  ></div>
                  <p className="text-white/80 text-xs md:text-sm">
                    {adminOnline
                      ? "Agent Online"
                      : isConnected
                        ? "Waiting for agent..."
                        : "Connecting..."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Chat Container */}
      <div className="flex-1 max-w-4xl w-full mx-auto flex flex-col z-10 relative">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-3 md:space-y-4">
          {isLoadingHistory && (
            <div className="text-center text-gray-400 py-4">
              <div className="animate-spin w-6 h-6 border-2 border-[#E95420] border-t-transparent rounded-full mx-auto mb-2"></div>
              Loading messages...
            </div>
          )}

          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[90%] md:max-w-[85%] lg:max-w-[70%] rounded-2xl md:rounded-[2rem] px-3 py-2 md:px-5 md:py-3 ${
                  msg.sender === "user"
                    ? "bg-[#E95420] text-white"
                    : "bg-[#2C001E]/90 text-gray-200 border border-[#E95420]/20"
                }`}
              >
                {msg.adminName && (
                  <span className="text-[10px] md:text-xs text-[#E95420] block mb-1 font-medium">
                    {msg.adminName}
                  </span>
                )}

                {/* File attachment */}
                {msg.fileUrl &&
                  (() => {
                    // Auto-detect file type if not set
                    let fileType = msg.fileType;
                    if (!fileType && msg.fileUrl) {
                      const ext = msg.fileUrl.split(".").pop().toLowerCase();
                      if (
                        ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(
                          ext,
                        )
                      ) {
                        fileType = "image";
                      } else if (["mp4", "webm", "ogg", "mov"].includes(ext)) {
                        fileType = "video";
                      } else {
                        fileType = "application";
                      }
                    }

                    return (
                      <div className="mb-2 relative group">
                        {fileType === "image" && (
                          <div className="relative">
                            <img
                              src={msg.fileUrl}
                              alt={msg.fileName}
                              className="max-w-full rounded-lg max-h-48 md:max-h-64 object-cover cursor-pointer hover:opacity-90 transition"
                              onClick={() => setSelectedImage(msg.fileUrl)}
                            />
                            {msg.sender === "user" && (
                              <button
                                onClick={() => deleteFile(msg)}
                                className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        )}
                        {fileType === "video" && (
                          <div className="relative">
                            <video
                              controls
                              className="max-w-full rounded-lg max-h-64"
                            >
                              <source src={msg.fileUrl} />
                            </video>
                            {msg.sender === "user" && (
                              <button
                                onClick={() => deleteFile(msg)}
                                className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                title="Delete"
                              >
                                <X size={14} />
                              </button>
                            )}
                          </div>
                        )}
                        {fileType === "application" && (
                          <div className="flex items-center gap-2">
                            <a
                              href={msg.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 text-sm underline"
                            >
                              <File size={16} />
                              {msg.fileName}
                            </a>
                            {msg.sender === "user" && (
                              <button
                                onClick={() => deleteFile(msg)}
                                className="bg-red-500 hover:bg-red-600 text-white rounded-full p-1"
                                title="Delete"
                              >
                                <X size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                {/* Only show text if it's not empty and not a file placeholder */}
                {msg.text &&
                  msg.text.trim() !== "" &&
                  !msg.text.startsWith("[File:") && (
                    <p className="text-sm md:text-base leading-relaxed">
                      {msg.text}
                    </p>
                  )}
                <div className="flex items-center justify-end gap-1 mt-1 md:mt-2">
                  <span className="text-[10px] md:text-xs opacity-60">
                    {msg.timestamp.toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {/* WhatsApp tarzı tik ikonları - sadece kullanıcı mesajları için */}
                  {msg.sender === "user" && (
                    <span className="ml-1">
                      {messageStatuses[msg.id] === "read" ? (
                        <CheckCheck size={16} className="text-green-400" />
                      ) : messageStatuses[msg.id] === "delivered" ? (
                        <CheckCheck size={16} className="text-white/60" />
                      ) : (
                        <Check size={16} className="text-white/60" />
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Typing indicator - Admin yazıyor */}
          {adminTyping && (
            <div className="flex justify-start">
              <div className="bg-gray-800/80 text-gray-400 border border-[#E95420]/30 rounded-2xl px-5 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span
                      className="w-2 h-2 bg-[#E95420] rounded-full animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    ></span>
                    <span
                      className="w-2 h-2 bg-[#E95420] rounded-full animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    ></span>
                    <span
                      className="w-2 h-2 bg-[#E95420] rounded-full animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    ></span>
                  </div>
                  <span className="text-sm">typing...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Customer Form Modal */}
        {showForm && !formSubmitted && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 md:p-4 z-50">
            <div className="bg-[#300A24] border border-[#E95420]/30 rounded-xl md:rounded-3xl p-4 md:p-6 w-full max-w-md shadow-2xl">
              <div className="mb-4 md:mb-6">
                <h3 className="text-lg md:text-xl font-bold text-white">
                  Introduce Yourself
                </h3>
                <p className="text-white text-xs mt-1">
                  Please fill in your details below to continue the chat
                </p>
              </div>

              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <label className="text-white text-sm mb-1 block">
                    First Name *
                  </label>
                  <div className="relative">
                    <User
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-white"
                    />
                    <input
                      type="text"
                      required
                      value={customerInfo.firstName}
                      onChange={(e) => {
                        setFormError("");
                        setCustomerInfo((prev) => ({
                          ...prev,
                          firstName: e.target.value,
                        }));
                      }}
                      className="w-full bg-white/10 border border-[#E95420]/30 text-white pl-10 pr-4 py-3 rounded-3xl focus:outline-none focus:ring-2 focus:ring-[#E95420]"
                      placeholder="John"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-white text-sm mb-1 block">
                    Last Name *
                  </label>
                  <div className="relative">
                    <User
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-white"
                    />
                    <input
                      type="text"
                      required
                      value={customerInfo.lastName}
                      onChange={(e) => {
                        setFormError("");
                        setCustomerInfo((prev) => ({
                          ...prev,
                          lastName: e.target.value,
                        }));
                      }}
                      className="w-full bg-white/10 border border-[#E95420]/30 text-white pl-10 pr-4 py-3 rounded-3xl focus:outline-none focus:ring-2 focus:ring-[#E95420]"
                      placeholder="Doe"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-white text-sm mb-1 block">
                    Email *
                  </label>
                  <div className="relative">
                    <Mail
                      size={18}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-white"
                    />
                    <input
                      type="email"
                      required
                      value={customerInfo.email}
                      onChange={(e) => {
                        setFormError("");
                        setCustomerInfo((prev) => ({
                          ...prev,
                          email: e.target.value,
                        }));
                      }}
                      className="w-full bg-white/10 border border-[#E95420]/30 text-white pl-10 pr-4 py-3 rounded-3xl focus:outline-none focus:ring-2 focus:ring-[#E95420]"
                      placeholder="john@example.com"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-white text-sm mb-1 block">
                    Phone Number *
                  </label>
                  <div className="flex gap-2">
                    {/* Country Code Dropdown */}
                    <select
                      value={customerInfo.countryCode}
                      onChange={(e) =>
                        setCustomerInfo((prev) => ({
                          ...prev,
                          countryCode: e.target.value,
                        }))
                      }
                      className="bg-white/10 border border-[#E95420]/30 text-white px-3 py-3 rounded-3xl focus:outline-none focus:ring-2 focus:ring-[#E95420] w-28"
                    >
                      <option value="+44">🇬🇧 +44</option>
                      <option value="+353">🇮🇪 +353</option>
                    </select>

                    {/* Phone Number Input */}
                    <div className="relative flex-1">
                      <Phone
                        size={18}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-white"
                      />
                      <input
                        type="tel"
                        required
                        value={customerInfo.phone}
                        onChange={(e) => {
                          // Only allow digits and limit to 10 digits
                          const value = e.target.value
                            .replace(/\D/g, "")
                            .slice(0, 10);
                          setCustomerInfo((prev) => ({
                            ...prev,
                            phone: value,
                          }));
                        }}
                        pattern="[0-9]{10}"
                        minLength="10"
                        maxLength="10"
                        className="w-full bg-white/10 border border-[#E95420]/30 text-white pl-10 pr-4 py-3 rounded-3xl focus:outline-none focus:ring-2 focus:ring-[#E95420]"
                        placeholder="1234567890"
                      />
                    </div>
                  </div>
                </div>

                {formError && (
                  <div className="bg-red-500/20 border border-red-500/50 text-red-400 text-sm px-4 py-2.5 rounded-xl text-center">
                    {formError}
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full bg-[#E95420] hover:bg-[#d44516] text-white font-bold py-3 rounded-3xl transition-all transform hover:scale-[1.02]"
                >
                  Continue Chat
                </button>

                <p className="text-white text-xs text-center">
                  Your information helps us serve you better
                </p>
              </form>
            </div>
          </div>
        )}

        {/* Blocked Message */}
        {isBlocked && (
          <div className="p-4 bg-red-500/20 border-t border-red-500/50">
            <div className="flex items-center gap-3 text-red-400">
              <AlertTriangle size={20} />
              <span>Your access has been restricted. {blockReason}</span>
            </div>
          </div>
        )}

        {/* Rate Limit Warning */}
        {rateLimitError && (
          <div className="p-3 bg-yellow-500/20 border-t border-yellow-500/50">
            <div className="flex items-center gap-3 text-yellow-400 text-sm">
              <AlertTriangle size={18} />
              <span>{rateLimitError}</span>
            </div>
          </div>
        )}

        {/* Message Input - Sticky at bottom */}
        <form
          onSubmit={handleSendMessage}
          className="sticky bottom-0 p-3 md:p-6 border-t border-gray-800 bg-gray-900/95 backdrop-blur-sm rounded-[2rem]"
        >
          {/* Selected files preview */}
          {selectedFiles.length > 0 && (
            <div className="mb-2 md:mb-3 flex flex-wrap gap-1.5 md:gap-2">
              {selectedFiles.map((file, index) => (
                <div
                  key={index}
                  className="bg-white/10/50 border border-gray-700 rounded-3xl p-1.5 md:p-2 flex items-center gap-1.5 md:gap-2"
                >
                  {file.type.startsWith("image/") ? (
                    <Image size={14} className="text-[#E95420] md:w-4 md:h-4" />
                  ) : file.type.startsWith("video/") ? (
                    <Video size={14} className="text-[#E95420] md:w-4 md:h-4" />
                  ) : (
                    <File size={14} className="text-[#E95420] md:w-4 md:h-4" />
                  )}
                  <span className="text-white text-[10px] md:text-xs">
                    {file.name.length > 12
                      ? file.name.substring(0, 12) + "..."
                      : file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X size={12} className="md:w-3.5 md:h-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={uploadAndSendFiles}
                disabled={isUploading}
                className="bg-[#E95420] hover:bg-[#d44516] disabled:opacity-50 disabled:cursor-not-allowed text-white px-2 md:px-4 py-1.5 md:py-2 rounded-2xl text-[10px] md:text-xs font-semibold flex items-center gap-1"
              >
                {isUploading ? (
                  <>
                    <div className="w-2.5 h-2.5 md:w-3 md:h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span className="hidden md:inline">Uploading...</span>
                  </>
                ) : (
                  <>
                    <Send size={12} className="md:w-3.5 md:h-3.5" />
                    Send {selectedFiles.length}
                  </>
                )}
              </button>
            </div>
          )}

          <div className="flex gap-2 md:gap-3">
            {/* File input (hidden) */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              accept="image/*,video/*,.pdf,.doc,.docx,.txt"
              className="hidden"
            />

            {/* Attachment button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBlocked || isUploading}
              className="bg-white/10/50 border border-[#E95420]/30 text-[#E95420] px-3 py-3 md:px-4 md:py-4 rounded-lg md:rounded-3xl hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-[#E95420] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              title="Attach file"
            >
              {isUploading ? (
                <div className="w-4 h-4 md:w-5 md:h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Paperclip size={18} className="md:w-5 md:h-5" />
              )}
            </button>

            <input
              type="text"
              value={inputMessage}
              onChange={(e) => {
                setInputMessage(e.target.value);
                sendTypingEvent();
              }}
              disabled={isBlocked}
              className="flex-1 bg-gray-800/50 border border-[#E95420]/30 text-white px-3 py-3 md:px-5 md:py-4 rounded-lg md:rounded-[3rem] focus:outline-none focus:ring-2 focus:ring-[#E95420] placeholder-gray-500 text-sm md:text-base disabled:opacity-50 disabled:cursor-not-allowed"
              placeholder={isBlocked ? "Chat disabled" : "Type your message..."}
              autoFocus
            />
            <button
              type="submit"
              disabled={!inputMessage.trim() || isBlocked}
              className="bg-[#E95420] hover:bg-[#d44516] disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-3 md:px-6 md:py-4 rounded-xl md:rounded-[3rem] transition-all transform hover:scale-105"
            >
              <Send size={18} className="md:w-5 md:h-5" />
            </button>
          </div>
        </form>
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
    </div>
  );
}

export default ChatPage;
