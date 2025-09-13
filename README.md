# WhatsApp Clone - Real-time Chat Application

A real-time chat application built with Django, Django Channels, and Tailwind CSS that looks and functions like WhatsApp.

## Features

🚀 **Core Features:**
- Real-time messaging using WebSockets
- WhatsApp-like UI design with Tailwind CSS
- User authentication (login/logout/signup)
- One-to-one chat conversations
- Message status indicators (sent/delivered/read)
- Online/offline user status
- Typing indicators
- Responsive design for mobile and desktop

✨ **Advanced Features:**
- Dark mode toggle
- Modern toast notification system (replaces traditional alerts)
- User profiles with avatar upload and management
- Username-based default avatars with UI Avatars API
- User search and conversation starter
- Message timestamps
- Account deletion with immediate username reuse
- Session-based message handling for clean UX
- Real-time user status updates

## Technology Stack

- **Backend:** Django 4.2.9, Django Channels 4.0.0
- **WebSockets:** Django Channels with InMemoryChannelLayer (Redis for production)
- **Frontend:** HTML5, Tailwind CSS 3.x, JavaScript (ES6+)
- **Database:** SQLite (development) / PostgreSQL (production)
- **Real-time:** WebSocket connections for instant messaging

## Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/roy-sumon/chat-app-django.git
   cd chat-app-django
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Run database migrations:**
   ```bash
   python manage.py makemigrations
   python manage.py migrate
   ```

4. **Collect static files:**
   ```bash
   python manage.py collectstatic --noinput
   ```

5. **Create test users:**
   ```bash
   python create_test_data.py
   ```

6. **Start the development server:**
   ```bash
   python manage.py runserver
   ```

7. **Access the application:**
   Open your browser and go to `http://localhost:8000`

## Test Accounts

The application comes with pre-created test users:

- **Username:** `alice`, **Password:** `password123`
- **Username:** `bob`, **Password:** `password123`

## Usage

1. **Login:** Use any of the test accounts to login
2. **Start a Chat:** Click the "+" button or "Start New Chat" to search for users
3. **Send Messages:** Type your message and press Enter or click the send button
4. **Real-time Features:** Open multiple browser windows with different users to test real-time messaging
5. **Dark Mode:** Click the sun/moon icon in the top-right corner to toggle dark mode
6. **Emojis:** Click the emoji button next to the message input to open the emoji picker

## Project Structure

```
chat-app/
├── chatproject/           # Main Django project
│   ├── settings.py       # Django settings with Channels configuration
│   ├── asgi.py          # ASGI configuration for WebSockets
│   └── urls.py          # Main URL configuration
├── chat/                 # Chat application
│   ├── models.py        # Database models (User, Conversation, Message)
│   ├── views.py         # Django views for chat interface
│   ├── auth_views.py    # Authentication views
│   ├── consumers.py     # WebSocket consumers for real-time chat
│   ├── routing.py       # WebSocket URL routing
│   ├── admin.py         # Django admin configuration
│   └── templates/       # HTML templates
│       ├── base.html    # Base template with Tailwind CSS
│       ├── auth/        # Authentication templates
│       └── chat/        # Chat interface templates
├── static/              # Static files (CSS, JS, images)
│   └── js/
│       └── chat.js      # WebSocket client and UI interactions
├── requirements.txt     # Python dependencies
└── README.md           # This file
```

## Key Components

### Backend Components

1. **Models (`chat/models.py`):**
   - `UserProfile`: Extended user profile with avatar and online status
   - `Conversation`: Chat conversations between users
   - `Message`: Individual messages with status tracking
   - `TypingStatus`: Real-time typing indicators

2. **WebSocket Consumer (`chat/consumers.py`):**
   - Handles WebSocket connections for real-time messaging
   - Manages message sending/receiving, typing indicators, and user status

3. **Views (`chat/views.py` & `chat/auth_views.py`):**
   - Chat interface, user search, conversation management
   - User authentication (login, logout, signup)

### Frontend Components

1. **Templates:**
   - WhatsApp-inspired UI with Tailwind CSS
   - Responsive design for mobile and desktop
   - Dark mode support

2. **JavaScript (`static/js/chat.js`):**
   - WebSocket client for real-time communication
   - UI interactions and message handling
   - Emoji picker and user search functionality

## Production Deployment

For production deployment, consider the following:

1. **Redis Setup:**
   - Install and configure Redis server
   - Update `settings.py` to use `RedisChannelLayer`

2. **Database:**
   - Switch from SQLite to PostgreSQL
   - Update database configuration in settings

3. **Static Files:**
   - Configure proper static file serving (nginx/apache)
   - Use CDN for static assets if needed

4. **Security:**
   - Set `DEBUG = False`
   - Configure proper `ALLOWED_HOSTS`
   - Use environment variables for sensitive data

5. **WebServer:**
   - Use Daphne or uvicorn as ASGI server
   - Configure reverse proxy (nginx)

## License

This project is open source and available under the MIT License.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
