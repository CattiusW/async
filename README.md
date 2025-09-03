# async — A Moderated Chat App with AI and File Sharing

**async** is a real-time chat application that supports user messaging, file sharing, and AI-powered interactions. Built with moderation tools and OpenRouter integration, **async** is designed for communities that value control, flexibility, and intelligent conversation.

---

## Features

- Real-time messaging between users
- Message deletion by users
- File sharing support
- AI chatbot powered by OpenRouter
- Moderator commands for managing user activity
- Online user tracking

---

## Commands

| Command           | Description                                      | Access Level     |
|------------------|--------------------------------------------------|-----------------|
| `/lockdown`      | Blocks new connections to the chat               | Moderator only  |
| `/mute [user]`   | Prevents a user from sending messages            | Moderator only  |
| `/unmute [user]` | Restores messaging ability to a muted user       | Moderator only  |
| `/online`        | Displays a list of currently online users        | All users       |
| `@ai [query]     | Querys the openrouter ai                         | All users       |     
---

## Installation

Clone the repository:
    ```bash
   git clone https://github.com/cattiusw/async.git
   cd async
    
Install dependencies:

    npm install

Run setup script:

    bash setup.sh

Add your OpenRouter API key:

    Open server.js

    Replace 'YOUR_OPEN_ROUTER_API_KEY' with your actual API key from https://openrouter.ai

Running the App

Start the server:

    npm start

Access the app:

    User Interface: http://localhost

Admin Panel: http://localhost/admin
AI Integration

async uses OpenRouter to power its AI chatbot. Ensure you have a valid API key and internet access for AI features to function properly.
File Sharing

Users can upload and share files directly in the chat. Supported file types and size limits can be configured in the app settings.
Development Notes

    Built with Node.js and Express

    Frontend uses basic HTML/CSS/JS

    AI responses are handled server-side via OpenRouter API

Contributing

Pull requests are welcome. If you have ideas for new features or improvements, feel free to fork the repo and submit a PR.
