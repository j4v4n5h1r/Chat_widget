import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ChatPage from './ChatPage';
import AgentDashboard from './AgentDashboard';
import ChatAdmin from './ChatAdmin';

/**
 * Main Chat Application
 * Handles routing for different pages
 */
function ChatApp() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/agent" element={<AgentDashboard />} />
        <Route path="/admin" element={<ChatAdmin />} />
      </Routes>
    </Router>
  );
}

export default ChatApp;
