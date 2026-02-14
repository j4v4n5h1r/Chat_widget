import { useState, useRef, useEffect } from 'react';
import { MessageCircle, X, Send, Paperclip, File as FileIcon, Image as ImageIcon, Video as VideoIcon } from 'lucide-react';

// Configure this for each project
const PROJECT_NAME = 'Qrypteon'; // Change this when using in different projects

function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: 1,
      text: 'Salam! Sizə necə kömək edə bilərik?',
      sender: 'system',
      timestamp: new Date()
    }
  ]);
  const [inputMessage, setInputMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const [sessionId] = useState(() => {
    // Try to get existing session from localStorage
    const stored = localStorage.getItem('chat_session_id');
    if (stored) return stored;
    const newId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    localStorage.setItem('chat_session_id', newId);
    return newId;
  });
  const messagesEndRef = useRef(null);
  const wsRef = useRef(null);
  const historyLoadedRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load user's message history from backend
  const loadMessageHistory = async () => {
    if (historyLoadedRef.current) return; // Only load once

    try {
      setIsLoadingHistory(true);
      const response = await fetch(`http://localhost:5003/api/contact/user-messages/${sessionId}`);
      const data = await response.json();

      if (data.success && data.messages.length > 0) {
        const loadedMessages = [];

        // Add welcome message first
        loadedMessages.push({
          id: 1,
          text: 'Salam! Sizə necə kömək edə bilərik?',
          sender: 'system',
          timestamp: new Date()
        });

        // Add all previous messages with their replies
        data.messages.forEach(msg => {
          // Add user message
          loadedMessages.push({
            id: msg.id,
            text: msg.text,
            sender: 'user',
            timestamp: new Date(msg.timestamp),
            fileUrl: msg.fileUrl,
            fileType: msg.fileType,
            fileName: msg.fileName
          });

          // Add admin replies
          msg.replies.forEach(reply => {
            loadedMessages.push({
              id: reply.id,
              text: reply.text,
              sender: 'system',
              timestamp: new Date(reply.timestamp),
              adminName: reply.admin,
              fileUrl: reply.fileUrl,
              fileType: reply.fileType,
              fileName: reply.fileName
            });
          });
        });

        setMessages(loadedMessages);
        historyLoadedRef.current = true;
      }
    } catch (error) {
      console.error('Error loading message history:', error);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Load history when widget opens
  useEffect(() => {
    if (isOpen && !historyLoadedRef.current) {
      loadMessageHistory();
    }
  }, [isOpen]);

  // WebSocket connection
  useEffect(() => {
    const connectWebSocket = () => {
      try {
        wsRef.current = new WebSocket('ws://localhost:5004');

        wsRef.current.onopen = () => {
          console.log('WebSocket connected');
          setIsConnected(true);
          // Register as user client with project name
          wsRef.current.send(JSON.stringify({
            type: 'register',
            sessionId: sessionId,
            clientType: 'user',
            project: PROJECT_NAME
          }));
        };

        wsRef.current.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('📩 WebSocket message received:', data);

            // Admin message received
            if (data.type === 'admin_message') {
              console.log('✅ Admin message detected, adding to messages');
              const adminMessage = {
                id: Date.now(),
                text: data.text,
                sender: 'system',
                timestamp: new Date(data.timestamp),
                adminName: data.adminName
              };
              setMessages(prev => {
                const newMessages = [...prev, adminMessage];
                console.log('💬 Updated messages:', newMessages);
                return newMessages;
              });
            }

            // File deleted by agent
            if (data.type === 'file_deleted') {
              console.log('🗑️ File deleted, removing message:', data.messageId);
              setMessages(prev => prev.filter(m => m.id !== data.messageId));
            }
          } catch (error) {
            console.error('Error parsing WebSocket message:', error);
          }
        };

        wsRef.current.onclose = () => {
          console.log('WebSocket disconnected');
          setIsConnected(false);
          // Reconnect after 3 seconds
          setTimeout(connectWebSocket, 3000);
        };

        wsRef.current.onerror = (error) => {
          console.error('WebSocket error:', error);
        };
      } catch (error) {
        console.error('WebSocket connection failed:', error);
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

  // Handle file upload
  const handleFileUpload = async (file) => {
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:5003/api/upload', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      if (result.success) {
        return result.file;
      } else {
        console.error('File upload failed:', result.error);
        return null;
      }
    } catch (error) {
      console.error('Upload error:', error);
      return null;
    }
  };

  // Handle file selection
  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    console.log(`📎 Selected ${files.length} file(s):`, files.map(f => f.name));
    if (files.length > 0) {
      // Add to existing files instead of replacing
      setSelectedFiles(prev => {
        const updated = [...prev, ...files];
        console.log(`📦 Total files now: ${updated.length}`, updated.map(f => f.name));
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
  const deleteFile = async (msg) => {
    try {
      // Extract filename from URL
      const filename = msg.fileUrl.split('/').pop();

      // Delete from server
      await fetch(`http://localhost:5003/api/upload/${filename}`, {
        method: 'DELETE'
      });

      // Remove from messages
      setMessages(prev => prev.filter(m => m.id !== msg.id));

      // Notify agent via WebSocket that file was deleted
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
      setMessages(prev => prev.filter(m => m.id !== msg.id));
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!inputMessage.trim() && selectedFiles.length === 0) return;

    const messageText = inputMessage;
    setInputMessage('');
    const filesToSend = [...selectedFiles];
    setSelectedFiles([]);

    // Upload files first if any
    setIsUploading(true);
    const uploadedFiles = [];
    for (const file of filesToSend) {
      const uploaded = await handleFileUpload(file);
      if (uploaded) {
        uploadedFiles.push(uploaded);
      }
    }
    setIsUploading(false);

    // Send message with files
    try {
      const response = await fetch('http://localhost:5003/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sessionId,
          email: `${sessionId}@chat.local`,
          message: messageText || '[Files]',
          project: PROJECT_NAME
        })
      });

      const result = await response.json();

      if (result.success && result.data) {
        const realMessageId = result.data.id;

        // Add text message if exists
        if (messageText) {
          const newMessage = {
            id: realMessageId,
            text: messageText,
            sender: 'user',
            timestamp: new Date()
          };
          setMessages(prev => [...prev, newMessage]);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'user_message',
              text: messageText,
              messageId: realMessageId,
              sessionId: sessionId,
              project: PROJECT_NAME
            }));
          }
        }

        // Send each file as separate message
        for (const file of uploadedFiles) {
          const fileMessageId = `${realMessageId}_file_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

          const fileMessage = {
            id: fileMessageId,
            text: `[File: ${file.originalName}]`,
            sender: 'user',
            timestamp: new Date(),
            fileUrl: file.url,
            fileType: file.type,
            fileName: file.originalName
          };
          setMessages(prev => [...prev, fileMessage]);

          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({
              type: 'user_message',
              text: `[File: ${file.originalName}]`,
              messageId: fileMessageId,
              sessionId: sessionId,
              project: PROJECT_NAME,
              fileUrl: file.url,
              fileType: file.type,
              fileName: file.originalName
            }));
          }
        }
      }
    } catch (error) {
      console.error('Error saving message:', error);
    }
  };

  return (
    <div className="fixed bottom-6 right-6 z-50">
      {/* Chat Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white rounded-full p-4 shadow-2xl transition-all transform hover:scale-110 animate-pulse"
        >
          <MessageCircle size={28} />
        </button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl shadow-2xl w-96 h-[500px] flex flex-col border border-purple-500/30 overflow-hidden">
          {/* Header */}
          <div className="bg-gradient-to-r from-purple-600 to-pink-600 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-white/20 p-2 rounded-lg">
                <MessageCircle size={24} className="text-white" />
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">Dəstək</h3>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full animate-pulse ${isConnected ? 'bg-green-400' : 'bg-yellow-400'}`}></div>
                  <p className="text-white/80 text-xs">{isConnected ? 'Online' : 'Bağlanır...'}</p>
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white hover:bg-white/20 p-2 rounded-lg transition"
            >
              <X size={20} />
            </button>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    msg.sender === 'user'
                      ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white'
                      : 'bg-gray-800 text-gray-200 border border-gray-700'
                  }`}
                >
                  {msg.adminName && (
                    <span className="text-xs text-purple-400 block mb-1">{msg.adminName}</span>
                  )}

                  {/* File attachment */}
                  {msg.fileUrl && (
                    <div className="mb-2 relative group">
                      {msg.fileType === 'image' && (
                        <div className="relative">
                          <img
                            src={msg.fileUrl}
                            alt={msg.fileName}
                            className="max-w-full rounded-lg max-h-48 object-cover"
                          />
                          <button
                            onClick={() => deleteFile(msg)}
                            className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Sil"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}
                      {msg.fileType === 'video' && (
                        <div className="relative">
                          <video controls className="max-w-full rounded-lg max-h-48">
                            <source src={msg.fileUrl} />
                          </video>
                          <button
                            onClick={() => deleteFile(msg)}
                            className="absolute top-1 right-1 bg-red-500 hover:bg-red-600 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Sil"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      )}
                      {msg.fileType === 'application' && (
                        <div className="flex items-center gap-2">
                          <a href={msg.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm underline">
                            <FileIcon size={16} />
                            {msg.fileName}
                          </a>
                          <button
                            onClick={() => deleteFile(msg)}
                            className="bg-red-500 hover:bg-red-600 text-white rounded-full p-1"
                            title="Sil"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="text-sm">{msg.text}</p>
                  <span className="text-xs opacity-60 mt-1 block">
                    {msg.timestamp.toLocaleTimeString('az-AZ', {
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Message Input */}
          <form onSubmit={handleSendMessage} className="p-4 border-t border-gray-800 bg-gray-900/50">
            {/* Selected files preview */}
            {selectedFiles.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {selectedFiles.map((file, index) => (
                  <div key={index} className="bg-gray-800/50 border border-gray-700 rounded-lg p-2 flex items-center gap-2">
                    {file.type.startsWith('image/') ? (
                      <ImageIcon size={16} className="text-purple-400" />
                    ) : file.type.startsWith('video/') ? (
                      <VideoIcon size={16} className="text-purple-400" />
                    ) : (
                      <FileIcon size={16} className="text-purple-400" />
                    )}
                    <span className="text-white text-xs">{file.name.length > 15 ? file.name.substring(0, 15) + '...' : file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="text-red-400 hover:text-red-300"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
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
                className="bg-gray-800/50 border border-gray-700 text-purple-400 px-3 py-3 rounded-xl hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Dosya ekle"
              >
                {isUploading ? (
                  <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Paperclip size={20} />
                )}
              </button>

              <input
                type="text"
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                className="flex-1 bg-gray-800/50 border border-gray-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 placeholder-gray-500"
                placeholder="Mesajınızı yazın..."
                autoFocus
              />
              <button
                type="submit"
                disabled={isUploading}
                className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white px-4 py-3 rounded-xl transition-all transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                <Send size={20} />
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default ChatWidget;
