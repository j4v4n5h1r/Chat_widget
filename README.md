# Chat Widget Component

Modern, responsive chat/support widget component for React applications.

## Features

- 🎨 Modern gradient design with Tailwind CSS
- 📱 Fully responsive
- 💬 Contact form for offline mode
- 🔄 Real-time messaging interface
- ✨ Smooth animations
- 🌐 Multi-language support (Azerbaijani)
- 🎯 Easy to integrate

## Installation

### Option 1: Copy to your project

```bash
# Copy the entire ChatWidget folder to your components directory
cp -r ChatWidget /path/to/your/project/src/components/
```

### Option 2: Use as standalone component

Just copy `ChatWidget.jsx` to your project.

## Dependencies

```json
{
  "react": "^18.0.0",
  "lucide-react": "^0.263.1",
  "tailwindcss": "^3.3.0"
}
```

## Usage

### Basic Usage

```jsx
import ChatWidget from './components/ChatWidget/ChatWidget';

function App() {
  return (
    <div>
      {/* Your app content */}
      <ChatWidget />
    </div>
  );
}
```

### With Backend Integration

The widget automatically tries to send contact form data to:
```
POST http://localhost:5003/api/contact
```

Request body:
```json
{
  "name": "User Name",
  "email": "user@example.com",
  "message": "User message"
}
```

## Customization

### Colors

The widget uses Tailwind CSS classes. To customize colors, modify the gradient classes:

```jsx
// Primary gradient (button & header)
className="bg-gradient-to-r from-purple-600 to-pink-600"

// Change to your brand colors
className="bg-gradient-to-r from-blue-600 to-indigo-600"
```

### Position

Default position is bottom-right. To change:

```jsx
// Current: bottom-right
<div className="fixed bottom-6 right-6 z-50">

// Bottom-left
<div className="fixed bottom-6 left-6 z-50">

// Top-right
<div className="fixed top-6 right-6 z-50">
```

### Size

```jsx
// Current size
<div className="w-96 h-[600px]">

// Smaller
<div className="w-80 h-[500px]">

// Larger
<div className="w-[420px] h-[700px]">
```

### Language

To change language, update the text strings:

```jsx
// Azerbaijani (current)
"Hal hazırda çevrimdışıyız"

// English
"We're currently offline"

// Turkish
"Şu anda çevrimdışıyız"
```

## Backend API

This widget comes with a complete backend implementation using Express.js + PostgreSQL.

### Database Schema

```sql
-- Contact messages table
CREATE TABLE contact_messages (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'new',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Contact replies table
CREATE TABLE contact_replies (
  id SERIAL PRIMARY KEY,
  message_id INTEGER REFERENCES contact_messages(id) ON DELETE CASCADE,
  reply_text TEXT NOT NULL,
  admin_name VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### API Endpoints

All endpoints are implemented in `auth-api.js` (port 5003):

1. **POST /api/contact** - Submit new message
2. **GET /api/contact/messages** - Get all messages (Admin)
3. **POST /api/contact/reply** - Reply to message (Admin)
4. **PUT /api/contact/status** - Update message status (Admin)

### Admin Panel

Access the admin panel at: `http://localhost:3000/chat-admin`

Features:
- View all messages with filtering
- Reply to messages
- Update message status (new/replied/closed)
- Statistics dashboard
- Real-time message management

## Features Roadmap

- [ ] File upload support
- [ ] Emoji picker
- [ ] Typing indicators
- [ ] Read receipts
- [ ] Sound notifications
- [ ] Admin panel integration
- [ ] Multiple language support
- [ ] Dark/Light theme toggle

## License

MIT - Feel free to use in your projects

## Support

For issues or questions, create an issue in the repository.
