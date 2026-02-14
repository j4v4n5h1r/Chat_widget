import { useState, useEffect } from 'react';
import { Trash2, Plus, Users, Shield, LogOut, Download, UserCircle, ShieldAlert } from 'lucide-react';
import AdminLogin from './AdminLogin';
import * as XLSX from 'xlsx';

const API_URL = window.location.hostname === 'localhost' ? 'http://localhost:5003' : '';

/**
 * ChatAdmin - Admin Dashboard for Managing Agents
 * Allows creating, viewing, and deleting support agents
 * NOW WITH AUTHENTICATION!
 */
function ChatAdmin() {
  // Auth state
  const [admin, setAdmin] = useState(null);
  const [token, setToken] = useState(null);

  const [agents, setAgents] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newAgent, setNewAgent] = useState({
    username: '',
    password: '',
    name: '',
    email: ''
  });

  // Check for existing login
  useEffect(() => {
    const savedToken = localStorage.getItem('admin_token');
    const savedAdmin = localStorage.getItem('admin_info');
    if (savedToken && savedAdmin) {
      setToken(savedToken);
      setAdmin(JSON.parse(savedAdmin));
    }
  }, []);

  // Load agents and customers when authenticated
  useEffect(() => {
    if (admin && token) {
      loadAgents();
      loadCustomers();
    }
  }, [admin, token]);

  // Handle login
  const handleLogin = (adminInfo, adminToken) => {
    setAdmin(adminInfo);
    setToken(adminToken);
  };

  // Handle logout
  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_info');
    setAdmin(null);
    setToken(null);
  };

  // Show login if not authenticated
  if (!admin || !token) {
    return <AdminLogin onLogin={handleLogin} />;
  }

  const loadAgents = async () => {
    try {
      const response = await fetch(`${API_URL}/api/agents`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.success) {
        setAgents(data.agents);
      }
    } catch (error) {
      console.error('Error loading agents:', error);
    }
  };

  const loadCustomers = async () => {
    try {
      const response = await fetch(`${API_URL}/api/admin/customers`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      const data = await response.json();
      if (data.success) {
        setCustomers(data.customers);
      }
    } catch (error) {
      console.error('Error loading customers:', error);
    }
  };

  const handleExportCustomers = () => {
    if (customers.length === 0) {
      alert('No customers to export');
      return;
    }

    // Prepare data for Excel
    const excelData = customers.map(customer => ({
      'ID': customer.id,
      'Full Name': customer.full_name || '',
      'Email': customer.email || '',
      'Phone': customer.phone || '',
      'Country': customer.country || '',
      'IP Address': customer.ip_address || '',
      'VPN/Proxy': customer.is_vpn ? 'YES' : 'NO',
      'VPN Provider': customer.vpn_provider || '',
      'Created At': new Date(customer.created_at).toLocaleString()
    }));

    // Create worksheet
    const worksheet = XLSX.utils.json_to_sheet(excelData);

    // Set column widths
    const columnWidths = [
      { wch: 10 },  // ID
      { wch: 25 },  // Full Name
      { wch: 30 },  // Email
      { wch: 20 },  // Phone
      { wch: 15 },  // Country
      { wch: 18 },  // IP Address
      { wch: 12 },  // VPN/Proxy
      { wch: 20 },  // VPN Provider
      { wch: 20 }   // Created At
    ];
    worksheet['!cols'] = columnWidths;

    // Create workbook
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers');

    // Export to Excel file
    const fileName = `customers_export_${new Date().toISOString().split('T')[0]}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const handleCreateAgent = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/api/agent/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAgent)
      });

      const data = await response.json();
      if (data.success) {
        alert('Agent created successfully!');
        setShowCreateForm(false);
        setNewAgent({ username: '', password: '', name: '', email: '' });
        loadAgents();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (error) {
      console.error('Error creating agent:', error);
      alert('Failed to create agent');
    }
  };

  const handleDeleteAgent = async (agentId) => {
    if (!confirm('Are you sure you want to delete this agent?')) return;

    try {
      const response = await fetch(`${API_URL}/api/agent/${agentId}`, {
        method: 'DELETE'
      });

      const data = await response.json();
      if (data.success) {
        alert('Agent deleted successfully!');
        loadAgents();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch (error) {
      console.error('Error deleting agent:', error);
      alert('Failed to delete agent');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-3 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6 md:mb-8">
          <div className="flex items-center gap-2 md:gap-3">
            <Shield size={24} className="text-purple-400 md:w-8 md:h-8" />
            <div>
              <h1 className="text-xl md:text-3xl font-bold text-white">Agent Management</h1>
              <p className="text-gray-400 text-xs md:text-sm mt-0.5 md:mt-1">Logged in as: {admin.username}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 md:gap-3 w-full md:w-auto">
            <button
              onClick={() => setShowCreateForm(true)}
              className="flex-1 md:flex-none bg-purple-500 hover:bg-purple-600 text-white px-3 md:px-6 py-2 md:py-3 rounded-lg flex items-center justify-center gap-1.5 md:gap-2 text-sm md:text-base"
            >
              <Plus size={16} className="md:w-5 md:h-5" />
              <span className="hidden sm:inline">Create New Agent</span>
              <span className="sm:hidden">Create Agent</span>
            </button>
            <button
              onClick={handleLogout}
              className="bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 px-3 md:px-6 py-2 md:py-3 rounded-lg flex items-center gap-1.5 md:gap-2 text-sm md:text-base"
            >
              <LogOut size={16} className="md:w-5 md:h-5" />
              <span className="hidden sm:inline">Logout</span>
            </button>
          </div>
        </div>

        {/* Agents List */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg md:rounded-xl p-4 md:p-6 mb-6">
          <div className="flex items-center gap-2 mb-3 md:mb-4">
            <Users size={20} className="text-purple-400 md:w-6 md:h-6" />
            <h2 className="text-lg md:text-xl font-semibold text-white">Agents ({agents.length})</h2>
          </div>

          <div className="space-y-2 md:space-y-3">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="bg-gray-700/50 border border-gray-600 rounded-lg p-3 md:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0"
              >
                <div className="flex items-center gap-3 md:gap-4 flex-1">
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-purple-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <Users size={20} className="text-purple-400 md:w-6 md:h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-white font-semibold text-sm md:text-base truncate">{agent.name}</h3>
                    <p className="text-gray-400 text-xs md:text-sm">@{agent.username}</p>
                    <p className="text-gray-500 text-[10px] md:text-xs truncate">{agent.email}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 md:gap-3 w-full sm:w-auto justify-between sm:justify-end">
                  <div className="text-left sm:text-right">
                    <div className={`text-xs md:text-sm ${agent.isOnline ? 'text-green-400' : 'text-gray-400'}`}>
                      {agent.isOnline ? 'Online' : 'Offline'}
                    </div>
                    {agent.isOnline && (
                      <div className="text-[10px] md:text-xs text-gray-500">
                        {agent.assignedCount} chats
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => handleDeleteAgent(agent.id)}
                    className="p-1.5 md:p-2 hover:bg-red-500/20 rounded-lg text-red-400 hover:text-red-300"
                  >
                    <Trash2 size={16} className="md:w-[18px] md:h-[18px]" />
                  </button>
                </div>
              </div>
            ))}

            {agents.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                No agents found. Create your first agent to get started.
              </div>
            )}
          </div>
        </div>

        {/* Customers List */}
        <div className="bg-gray-800/50 border border-gray-700 rounded-lg md:rounded-xl p-4 md:p-6">
          <div className="flex items-center justify-between mb-3 md:mb-4">
            <div className="flex items-center gap-2">
              <UserCircle size={20} className="text-green-400 md:w-6 md:h-6" />
              <h2 className="text-lg md:text-xl font-semibold text-white">Customers ({customers.length})</h2>
            </div>
            <button
              onClick={handleExportCustomers}
              disabled={customers.length === 0}
              className="bg-green-500 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 md:px-4 py-2 rounded-lg flex items-center gap-2 text-sm md:text-base"
            >
              <Download size={16} className="md:w-5 md:h-5" />
              <span className="hidden sm:inline">Export Excel</span>
              <span className="sm:hidden">Export</span>
            </button>
          </div>

          <div className="space-y-2 md:space-y-3">
            {customers.map((customer) => (
              <div
                key={customer.id}
                className="bg-gray-700/50 border border-gray-600 rounded-lg p-3 md:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0"
              >
                <div className="flex items-center gap-3 md:gap-4 flex-1">
                  <div className="w-10 h-10 md:w-12 md:h-12 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <UserCircle size={20} className="text-green-400 md:w-6 md:h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-white font-semibold text-sm md:text-base truncate">{customer.full_name}</h3>
                      {customer.is_vpn && (
                        <span className="bg-red-500/20 border border-red-500/50 text-red-400 text-[9px] md:text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1">
                          <ShieldAlert size={10} className="md:w-3 md:h-3" />
                          VPN
                        </span>
                      )}
                    </div>
                    <p className="text-gray-400 text-xs md:text-sm truncate">{customer.email}</p>
                    <p className="text-gray-500 text-[10px] md:text-xs">{customer.phone}</p>
                  </div>
                </div>

                <div className="text-left sm:text-right">
                  <div className="text-xs md:text-sm text-gray-400">
                    {new Date(customer.created_at).toLocaleDateString()}
                  </div>
                  <div className="text-[10px] md:text-xs text-gray-500">
                    {new Date(customer.created_at).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}

            {customers.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                No customers found. Customers will appear here when they use the chat.
              </div>
            )}
          </div>
        </div>

        {/* Create Agent Modal */}
        {showCreateForm && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-3 md:p-4 z-50">
            <div className="bg-gray-900 border border-purple-500/30 rounded-xl md:rounded-2xl p-4 md:p-6 w-full max-w-md">
              <h3 className="text-lg md:text-xl font-bold text-white mb-4 md:mb-6">Create New Agent</h3>

              <form onSubmit={handleCreateAgent} className="space-y-4">
                <div>
                  <label className="text-gray-400 text-sm mb-1 block">Username *</label>
                  <input
                    type="text"
                    required
                    value={newAgent.username}
                    onChange={(e) => setNewAgent({ ...newAgent, username: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="agent1"
                  />
                </div>

                <div>
                  <label className="text-gray-400 text-sm mb-1 block">Password *</label>
                  <input
                    type="password"
                    required
                    value={newAgent.password}
                    onChange={(e) => setNewAgent({ ...newAgent, password: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="••••••••"
                  />
                </div>

                <div>
                  <label className="text-gray-400 text-sm mb-1 block">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={newAgent.name}
                    onChange={(e) => setNewAgent({ ...newAgent, name: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="John Doe"
                  />
                </div>

                <div>
                  <label className="text-gray-400 text-sm mb-1 block">Email *</label>
                  <input
                    type="email"
                    required
                    value={newAgent.email}
                    onChange={(e) => setNewAgent({ ...newAgent, email: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 text-white px-4 py-3 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                    placeholder="agent@example.com"
                  />
                </div>

                <div className="flex gap-3 mt-6">
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(false)}
                    className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white py-3 rounded-xl"
                  >
                    Create Agent
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatAdmin;
