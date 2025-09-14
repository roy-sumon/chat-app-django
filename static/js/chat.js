// Chat functionality with WebSocket support
class ChatApp {
    constructor() {
        this.chatSocket = null;
        
        // Try multiple ways to get the conversation ID
        this.conversationId = window.conversationId || 
                             (typeof conversationId !== 'undefined' ? conversationId : null) ||
                             new URLSearchParams(window.location.search).get('conversation');
        
        this.currentUserId = window.currentUserId || 
                            (typeof currentUserId !== 'undefined' ? currentUserId : null);
        
        this.currentUsername = window.currentUsername || 
                              (typeof currentUsername !== 'undefined' ? currentUsername : 'unknown');
        
        this.typingTimer = null;
        this.isTyping = false;
        
        // Track when this session started to avoid notifications for old messages
        this.sessionStartTime = new Date();
        this.connectionReady = false; // Flag to track if connection is fully established
        this.allowNotifications = false; // More strict flag for notifications
        this.initialLoadComplete = false; // Track if initial messages have loaded
        
        
        this.init();
    }
    
    init() {
        this.setupEventListeners();
        this.setupModal();
        this.setupDeleteModals();
        
        if (this.conversationId) {
            this.connectWebSocket();
        }
        
        // Don't request notification permission automatically
        // User can enable it manually when they send their first message
        
        // Auto-scroll to bottom of messages
        this.scrollToBottom();
    }
    
    setupEventListeners() {
        // Mobile navigation
        this.setupMobileNavigation();
        
        // Message sending
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');
        
        if (messageInput && sendBtn) {
            messageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
                this.handleTyping();
            });
            
            messageInput.addEventListener('keyup', () => {
                this.handleTypingStop();
            });
            
            sendBtn.addEventListener('click', () => {
                this.sendMessage();
            });
        }
        
        
        // Conversation selection - using event delegation
        this.setupConversationSelection();
        
        // Search functionality
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchConversations(e.target.value);
            });
        }
        
        // Message search (Ctrl+F in chat)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'f' && this.conversationId) {
                e.preventDefault();
                this.showMessageSearchModal();
            }
        });
        
        // File upload functionality
        console.log('Initializing file upload functionality...');
        this.setupFileUpload();
    }
    
    setupModal() {
        const newChatBtn = document.getElementById('newChatBtn');
        const startChatBtn = document.getElementById('startChatBtn');
        const closeModalBtn = document.getElementById('closeModalBtn');
        const modal = document.getElementById('newChatModal');
        const userSearchInput = document.getElementById('userSearchInput');
        
        [newChatBtn, startChatBtn].forEach(btn => {
            if (btn) {
                btn.addEventListener('click', () => {
                    modal.classList.remove('hidden');
                    userSearchInput.focus();
                });
            }
        });
        
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                modal.classList.add('hidden');
            });
        }
        
        // Close modal on outside click
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        }
        
        // User search
        if (userSearchInput) {
            userSearchInput.addEventListener('input', (e) => {
                this.searchUsers(e.target.value);
            });
        }
    }
    
    setupDeleteModals() {
        // Message delete modal
        const deleteMessageModal = document.getElementById('deleteMessageModal');
        const cancelDeleteMessage = document.getElementById('cancelDeleteMessage');
        const confirmDeleteMessage = document.getElementById('confirmDeleteMessage');
        
        // Conversation delete modal
        const deleteConversationModal = document.getElementById('deleteConversationModal');
        const cancelDeleteConversation = document.getElementById('cancelDeleteConversation');
        const confirmDeleteConversation = document.getElementById('confirmDeleteConversation');
        
        // Message delete handlers
        if (cancelDeleteMessage) {
            cancelDeleteMessage.addEventListener('click', () => {
                deleteMessageModal.classList.add('hidden');
                this.pendingDeleteMessageId = null;
            });
        }
        
        if (confirmDeleteMessage) {
            confirmDeleteMessage.addEventListener('click', () => {
                if (this.pendingDeleteMessageId) {
                    this.confirmDeleteMessage(this.pendingDeleteMessageId);
                    deleteMessageModal.classList.add('hidden');
                    this.pendingDeleteMessageId = null;
                }
            });
        }
        
        // Conversation delete handlers
        if (cancelDeleteConversation) {
            cancelDeleteConversation.addEventListener('click', () => {
                deleteConversationModal.classList.add('hidden');
                this.pendingDeleteConversationId = null;
            });
        }
        
        if (confirmDeleteConversation) {
            confirmDeleteConversation.addEventListener('click', () => {
                if (this.pendingDeleteConversationId) {
                    this.confirmDeleteConversation(this.pendingDeleteConversationId);
                    deleteConversationModal.classList.add('hidden');
                    this.pendingDeleteConversationId = null;
                }
            });
        }
        
        // Chat options menu (3-dot menu) in chat header
        this.setupChatOptionsMenu();
        
        // Conversation options menus in conversation list
        this.setupConversationOptionsMenus();
        
        // Conversation delete button (now inside the options menu)
        const deleteConversationBtn = document.getElementById('deleteConversationBtn');
        if (deleteConversationBtn) {
            deleteConversationBtn.addEventListener('click', () => {
                const conversationId = deleteConversationBtn.dataset.conversationId;
                if (conversationId) {
                    this.showDeleteConversationModal(conversationId);
                    // Hide the options menu
                    this.hideChatOptionsMenu();
                }
            });
        }
        
        // Message action handlers
        this.setupMessageActionHandlers();
    }
    
    setupChatOptionsMenu() {
        const chatOptionsBtn = document.getElementById('chatOptionsBtn');
        const chatOptionsMenu = document.getElementById('chatOptionsMenu');
        
        if (chatOptionsBtn && chatOptionsMenu) {
            chatOptionsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                chatOptionsMenu.classList.toggle('hidden');
            });
            
            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!chatOptionsBtn.contains(e.target) && !chatOptionsMenu.contains(e.target)) {
                    chatOptionsMenu.classList.add('hidden');
                }
            });
        }
    }
    
    hideChatOptionsMenu() {
        const chatOptionsMenu = document.getElementById('chatOptionsMenu');
        if (chatOptionsMenu) {
            chatOptionsMenu.classList.add('hidden');
        }
    }
    
    setupConversationOptionsMenus() {
        // Use event delegation since conversation items might be added dynamically
        document.addEventListener('click', (e) => {
            // Conversation options button
            if (e.target.closest('.conversation-options-btn')) {
                e.preventDefault();
                e.stopPropagation();
                const btn = e.target.closest('.conversation-options-btn');
                const menu = btn.parentElement.querySelector('.conversation-options-menu');
                
                // Close all other open conversation option menus
                document.querySelectorAll('.conversation-options-menu').forEach(m => {
                    if (m !== menu) m.classList.add('hidden');
                });
                
                // Toggle current menu
                menu.classList.toggle('hidden');
            }
            
            // Conversation delete button
            else if (e.target.closest('.conversation-delete-btn')) {
                e.preventDefault();
                e.stopPropagation();
                const btn = e.target.closest('.conversation-delete-btn');
                const conversationId = btn.dataset.conversationId;
                if (conversationId) {
                    this.showDeleteConversationModal(conversationId);
                    // Hide all conversation option menus
                    this.hideAllConversationOptionsMenus();
                }
            }
            
            // Click outside to close conversation option menus (but not when clicking conversation item)
            else if (!e.target.closest('.conversation-options-btn') && 
                     !e.target.closest('.conversation-options-menu') &&
                     !e.target.closest('.conversation-item')) {
                this.hideAllConversationOptionsMenus();
            }
        });
        
        // Prevent conversation selection when clicking on options menu area
        document.addEventListener('click', (e) => {
            if (e.target.closest('.conversation-options-btn') || 
                e.target.closest('.conversation-options-menu')) {
                e.stopPropagation();
            }
        });
    }
    
    hideAllConversationOptionsMenus() {
        document.querySelectorAll('.conversation-options-menu').forEach(menu => {
            menu.classList.add('hidden');
        });
    }
    
    setupConversationSelection() {
        // Use event delegation for conversation selection
        document.addEventListener('click', (e) => {
            const conversationItem = e.target.closest('.conversation-item');
            if (conversationItem && 
                !e.target.closest('.conversation-options-btn') && 
                !e.target.closest('.conversation-options-menu')) {
                const conversationId = conversationItem.dataset.conversationId;
                if (conversationId) {
                    this.selectConversation(conversationId);
                }
            }
        });
    }
    
    setupMessageActionHandlers() {
        // Use event delegation for message actions since messages are added dynamically
        document.addEventListener('click', (e) => {
            // Message actions button
            if (e.target.closest('.message-actions-btn')) {
                e.preventDefault();
                e.stopPropagation();
                const btn = e.target.closest('.message-actions-btn');
                const menu = btn.parentElement.querySelector('.message-actions-menu');
                
                // Close all other open menus
                document.querySelectorAll('.message-actions-menu').forEach(m => {
                    if (m !== menu) m.classList.add('hidden');
                });
                
                // Toggle current menu
                menu.classList.toggle('hidden');
            }
            
            // Delete button in message actions
            else if (e.target.closest('.delete-btn')) {
                e.preventDefault();
                e.stopPropagation();
                const btn = e.target.closest('.delete-btn');
                const messageId = btn.dataset.messageId;
                if (messageId) {
                    this.showDeleteMessageModal(messageId);
                    // Hide the menu
                    const menu = btn.closest('.message-actions-menu');
                    if (menu) menu.classList.add('hidden');
                }
            }
            
            // Edit button in message actions
            else if (e.target.closest('.edit-btn')) {
                e.preventDefault();
                e.stopPropagation();
                const btn = e.target.closest('.edit-btn');
                const messageId = btn.dataset.messageId;
                if (messageId) {
                    this.startEditingMessage(messageId);
                    // Hide the menu
                    const menu = btn.closest('.message-actions-menu');
                    if (menu) menu.classList.add('hidden');
                }
            }
            
            // Click outside to close menus
            else if (!e.target.closest('.message-actions-btn') && !e.target.closest('.message-actions-menu')) {
                document.querySelectorAll('.message-actions-menu').forEach(menu => {
                    menu.classList.add('hidden');
                });
            }
        });
    }
    
    showDeleteMessageModal(messageId) {
        this.pendingDeleteMessageId = messageId;
        const modal = document.getElementById('deleteMessageModal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }
    
    showDeleteConversationModal(conversationId) {
        this.pendingDeleteConversationId = conversationId;
        const modal = document.getElementById('deleteConversationModal');
        if (modal) {
            modal.classList.remove('hidden');
        }
    }
    
    connectWebSocket() {
        if (!this.conversationId) {
            console.error('No conversation ID provided for WebSocket connection');
            console.error('Current URL:', window.location.href);
            console.error('URL params:', new URLSearchParams(window.location.search));
            // Suppressed alert: No conversation ID found
            return;
        }
        
        const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${wsScheme}://${window.location.host}/ws/chat/${this.conversationId}/`;
        
        this.updateConnectionStatus('connecting');
        
        try {
            this.chatSocket = new WebSocket(wsUrl);
        } catch (error) {
            console.error('Failed to create WebSocket:', error);
            this.updateConnectionStatus('error');
            return;
        }
        
        this.chatSocket.onopen = (e) => {
            this.updateConnectionStatus('connected');
            // Mark connection as ready after a delay to allow initial messages to load
            setTimeout(() => {
                this.connectionReady = true;
                this.initialLoadComplete = true;
            }, 1500);
            
            // Notifications will only be enabled when user actively sends a message
        };
        
        this.chatSocket.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                this.handleWebSocketMessage(data);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        this.chatSocket.onclose = (e) => {
            console.log('WebSocket closed:', e.code, e.reason);
            this.connectionReady = false; // Reset connection ready flag
            this.allowNotifications = false; // Reset notification flag
            this.initialLoadComplete = false; // Reset initial load flag
            
            if (e.code === 4001) {
                console.error('WebSocket authentication failed - User not logged in');
                this.updateConnectionStatus('error');
                // Suppressed alert: Authentication failed. Please login and refresh the page.
                return;
            }
            
            this.updateConnectionStatus('disconnected');
            
            // Attempt to reconnect after 3 seconds if not intentionally closed
            if (e.code !== 1000) {
                setTimeout(() => {
                    if (this.conversationId) {
                        console.log('Attempting to reconnect...');
                        this.connectWebSocket();
                    }
                }, 3000);
            }
        };
        
        this.chatSocket.onerror = (e) => {
            console.error('WebSocket error:', e);
            this.updateConnectionStatus('error');
        };
    }
    
    handleWebSocketMessage(data) {
        switch (data.type) {
            case 'message':
            case 'file_message':
                this.displayMessage(data);
                this.scrollToBottom();
                this.playReceiveSound();
                this.showBrowserNotification(data);
                break;
            case 'typing':
                this.handleTypingIndicator(data);
                break;
            case 'user_status':
                this.updateUserStatus(data);
                break;
            case 'message_status':
                this.updateMessageStatus(data);
                break;
            case 'reaction':
                this.handleMessageReaction(data);
                break;
            case 'message_edit':
                this.handleMessageEdit(data);
                break;
            case 'message_delete':
                this.handleMessageDelete(data);
                break;
            case 'user_activity':
                this.handleUserActivity(data);
                break;
        }
    }
    
    sendMessage() {
        const messageInput = document.getElementById('messageInput');
        if (!messageInput) {
            console.error('Message input not found');
            return;
        }
        
        const message = messageInput.value.trim();
        
        // If there's a file selected, send file message
        if (this.selectedFile) {
            this.sendFileMessage();
            return;
        }
        
        if (!message) {
            return;
        }
        
        if (!this.chatSocket) {
            console.error('No WebSocket connection');
            // Suppressed alert: Not connected to chat server
            return;
        }
        
        if (this.chatSocket.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not open, state:', this.chatSocket.readyState);
            // Suppressed alert: Connection lost. Trying to reconnect...
            return;
        }
        
        try {
            // Add temporary message with "sending" status
            const tempId = Date.now();
            this.displayTempMessage(message, tempId);
            
            const messageData = {
                'type': 'message',
                'message': message,
                'temp_id': tempId
            };
            
            this.chatSocket.send(JSON.stringify(messageData));
            
            messageInput.value = '';
            this.stopTyping();
            
            // Enable notifications after user sends their first message
            this.requestNotificationPermission();
            
            // Allow notifications after a small delay
            setTimeout(() => {
                this.allowNotifications = true;
            }, 1000);
            
            // Play send sound (optional, can be disabled)
            this.playSendSound();
            
        } catch (error) {
            console.error('Error sending message:', error);
            // Suppressed alert: Failed to send message
        }
    }
    
    displayMessage(data) {
        // Remove temp message if it exists
        if (data.temp_id) {
            const tempMessage = document.querySelector(`[data-temp-id="${data.temp_id}"]`);
            if (tempMessage) {
                tempMessage.remove();
            }
        }
        
        const messagesList = document.getElementById('messagesList');
        if (!messagesList) {
            console.error('Messages list element not found');
            return;
        }
        
        const isOwnMessage = data.user_id === this.currentUserId;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-item ${isOwnMessage ? 'flex justify-end' : 'flex justify-start'}`;
        if (data.message_id) {
            messageDiv.dataset.messageId = data.message_id;
        }
        
        const bubbleClass = isOwnMessage 
            ? 'bg-whatsapp-light-green text-gray-800' 
            : 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white';
        
        let timestamp = 'now';
        try {
            timestamp = new Date(data.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        } catch (e) {
            console.warn('Invalid timestamp:', data.timestamp);
        }
        
        // Simplified message HTML to avoid template literal issues
        const messageContent = document.createElement('div');
        messageContent.className = `max-w-xs sm:max-w-sm md:max-w-md lg:max-w-lg px-3 md:px-4 py-2 rounded-lg message-bubble ${bubbleClass} shadow-md`;
        
        // Handle file messages
        if (data.file_url || data.file_name) {
            const fileContainer = this.createFileMessageElement(data);
            messageContent.appendChild(fileContainer);
            
            // Add text content if present
            if (data.message && data.message.trim()) {
                const messageTextP = document.createElement('p');
                messageTextP.className = 'message-text mt-2';
                messageTextP.textContent = data.message;
                messageContent.appendChild(messageTextP);
            }
        } else {
            // Regular text message
            const messageTextP = document.createElement('p');
            messageTextP.className = 'message-text';
            messageTextP.textContent = data.message || 'Empty message';
            messageContent.appendChild(messageTextP);
        }
        
        const timeDiv = document.createElement('div');
        timeDiv.className = 'flex items-center justify-end mt-1 space-x-1';
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'text-xs text-gray-500 dark:text-gray-400';
        timeSpan.textContent = timestamp;
        
        timeDiv.appendChild(timeSpan);
        
        if (isOwnMessage) {
            const statusSpan = document.createElement('span');
            statusSpan.className = 'message-status';
            statusSpan.innerHTML = `
                <svg class="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                </svg>
            `;
            timeDiv.appendChild(statusSpan);
        }
        
        messageContent.appendChild(timeDiv);
        messageDiv.appendChild(messageContent);
        
        messagesList.appendChild(messageDiv);
    }
    
    handleTyping() {
        if (!this.isTyping && this.chatSocket && this.chatSocket.readyState === WebSocket.OPEN) {
            this.isTyping = true;
            this.chatSocket.send(JSON.stringify({
                'type': 'typing',
                'is_typing': true
            }));
        }
    }
    
    handleTypingStop() {
        clearTimeout(this.typingTimer);
        this.typingTimer = setTimeout(() => {
            this.stopTyping();
        }, 1000);
    }
    
    stopTyping() {
        if (this.isTyping && this.chatSocket && this.chatSocket.readyState === WebSocket.OPEN) {
            this.isTyping = false;
            this.chatSocket.send(JSON.stringify({
                'type': 'typing',
                'is_typing': false
            }));
        }
    }
    
    handleTypingIndicator(data) {
        const typingIndicator = document.getElementById('typingIndicator');
        if (data.is_typing) {
            typingIndicator.classList.remove('hidden');
            this.scrollToBottom();
        } else {
            typingIndicator.classList.add('hidden');
        }
    }
    
    updateUserStatus(data) {
        const userStatus = document.getElementById('userStatus');
        if (userStatus && data.user_id !== this.currentUserId) {
            if (data.is_online) {
                userStatus.textContent = 'Online';
            } else {
                userStatus.textContent = 'Offline';
            }
        }
        
        // Update online indicator in conversation list
        const conversationItem = document.querySelector(`[data-user-id="${data.user_id}"]`);
        if (conversationItem) {
            const onlineIndicator = conversationItem.querySelector('.absolute.bottom-0.right-0');
            if (data.is_online) {
                if (!onlineIndicator) {
                    const indicator = document.createElement('div');
                    indicator.className = 'absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-white dark:border-gray-800';
                    conversationItem.querySelector('.relative').appendChild(indicator);
                }
            } else {
                if (onlineIndicator) {
                    onlineIndicator.remove();
                }
            }
        }
    }
    
    updateMessageStatus(data) {
        const messageElement = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageElement) {
            const statusIcon = messageElement.querySelector('.message-status svg');
            if (statusIcon) {
                statusIcon.className = 'w-4 h-4';
                if (data.status === 'read') {
                    statusIcon.className += ' text-blue-500';
                } else if (data.status === 'delivered') {
                    statusIcon.className += ' text-gray-500';
                } else {
                    statusIcon.className += ' text-gray-400';
                }
            }
        }
    }
    
    selectConversation(conversationId) {
        window.location.href = `/?conversation=${conversationId}`;
    }
    
    searchConversations(query) {
        const conversations = document.querySelectorAll('.conversation-item');
        
        conversations.forEach(item => {
            const name = item.querySelector('h4').textContent.toLowerCase();
            const lastMessage = item.querySelector('p').textContent.toLowerCase();
            
            if (name.includes(query.toLowerCase()) || lastMessage.includes(query.toLowerCase())) {
                item.style.display = '';
            } else {
                item.style.display = 'none';
            }
        });
    }
    
    showMessageSearchModal() {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center';
        modal.innerHTML = `
            <div class="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-96 max-w-sm mx-4 p-4">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-semibold text-gray-900 dark:text-white">Search Messages</h3>
                    <button id="closeSearchModal" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">✖</button>
                </div>
                <input type="text" id="messageSearchInput" placeholder="Type to search..." class="w-full px-4 py-2 mb-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-whatsapp-green" />
                <div id="messageSearchResults" class="max-h-60 overflow-y-auto custom-scrollbar text-sm"></div>
            </div>
        `;
        document.body.appendChild(modal);
        
        const close = () => modal.remove();
        modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
        modal.querySelector('#closeSearchModal').addEventListener('click', close);
        
        const input = modal.querySelector('#messageSearchInput');
        input.focus();
        input.addEventListener('input', (e) => {
            this.searchMessages(e.target.value);
        });
    }
    
    searchMessages(query) {
        const results = [];
        const messages = document.querySelectorAll('#messagesList .message-item');
        const q = query.toLowerCase();
        
        messages.forEach(item => {
            const text = item.querySelector('.message-text')?.textContent?.toLowerCase() || '';
            if (q && text.includes(q)) {
                const snippet = text.length > 80 ? text.slice(0, 77) + '...' : text;
                results.push({ id: item.dataset.messageId, snippet });
            }
        });
        
        const container = document.getElementById('messageSearchResults');
        if (results.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-500 dark:text-gray-400 py-4">No results</p>';
            return;
        }
        
        container.innerHTML = results.map(r => `
            <div class="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer rounded" data-mid="${r.id}">${this.escapeHtml(r.snippet)}</div>
        `).join('');
        
        container.querySelectorAll('[data-mid]').forEach(el => {
            el.addEventListener('click', () => {
                const target = document.querySelector(`[data-message-id="${el.dataset.mid}"]`);
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('ring-2', 'ring-blue-400');
                    setTimeout(() => target.classList.remove('ring-2', 'ring-blue-400'), 1500);
                }
            });
        });
    }
    
    async searchUsers(query) {
        const resultsContainer = document.getElementById('userSearchResults');
        
        if (query.length < 2) {
            resultsContainer.innerHTML = '<p class="text-center text-gray-500 dark:text-gray-400 py-4">Type to search users...</p>';
            return;
        }
        
        try {
            const response = await fetch(`/search-users/?q=${encodeURIComponent(query)}`);
            const data = await response.json();
            
            if (data.users.length === 0) {
                resultsContainer.innerHTML = '<p class="text-center text-gray-500 dark:text-gray-400 py-4">No users found</p>';
                return;
            }
            
            resultsContainer.innerHTML = data.users.map(user => `
                <div class="user-item p-3 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer rounded-lg transition-colors" data-user-id="${user.id}">
                    <div class="flex items-center space-x-3">
                        <div class="relative">
                            <img src="${user.avatar}" alt="Avatar" class="w-10 h-10 rounded-full">
                            ${user.is_online ? '<div class="absolute bottom-0 right-0 w-3 h-3 bg-green-400 rounded-full border-2 border-white dark:border-gray-800"></div>' : ''}
                        </div>
                        <div>
                            <h4 class="font-semibold text-gray-900 dark:text-white">${this.escapeHtml(user.display_name)}</h4>
                            <p class="text-sm text-gray-500 dark:text-gray-400">@${this.escapeHtml(user.username)}</p>
                        </div>
                    </div>
                </div>
            `).join('');
            
            // Add click handlers to user items
            resultsContainer.querySelectorAll('.user-item').forEach(item => {
                item.addEventListener('click', () => {
                    this.startConversation(item.dataset.userId);
                });
            });
            
        } catch (error) {
            console.error('Error searching users:', error);
            resultsContainer.innerHTML = '<p class="text-center text-red-500 py-4">Error searching users</p>';
        }
    }
    
    async startConversation(userId) {
        try {
            const response = await fetch('/start-conversation/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCsrfToken()
                },
                body: JSON.stringify({ user_id: userId })
            });
            
            const data = await response.json();
            
            if (data.success) {
                window.location.href = data.redirect_url;
            } else {
                console.error('Error starting conversation: ' + data.error);
            }
        } catch (error) {
            console.error('Error starting conversation:', error);
            // Suppressed alert: Error starting conversation
        }
    }
    
    scrollToBottom() {
        const messagesContainer = document.getElementById('messagesContainer');
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    displayTempMessage(message, tempId) {
        const messagesList = document.getElementById('messagesList');
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-item flex justify-end';
        messageDiv.dataset.tempId = tempId;
        
        const timestamp = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        messageDiv.innerHTML = `
            <div class="max-w-xs lg:max-w-md px-4 py-2 rounded-lg message-bubble bg-whatsapp-light-green text-gray-800 shadow-md opacity-70">
                <p>${this.escapeHtml(message)}</p>
                <div class="flex items-center justify-end mt-1 space-x-1">
                    <span class="text-xs text-gray-500">${timestamp}</span>
                    <span class="message-status">
                        <svg class="w-4 h-4 text-gray-400 animate-pulse" fill="currentColor" viewBox="0 0 20 20">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path>
                        </svg>
                    </span>
                </div>
            </div>
        `;
        
        messagesList.appendChild(messageDiv);
        this.scrollToBottom();
    }
    
    playSendSound() {
        // Create a subtle send sound using Web Audio API
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.1);
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.1);
        } catch (e) {
            // Silently fail if Web Audio API is not supported
        }
    }
    
    updateConnectionStatus(status) {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            switch (status) {
                case 'connecting':
                    statusElement.textContent = 'Connecting...';
                    statusElement.className = 'text-xs text-yellow-500';
                    statusElement.classList.remove('hidden');
                    break;
                case 'connected':
                    statusElement.classList.add('hidden');
                    break;
                case 'disconnected':
                    statusElement.textContent = 'Disconnected - Reconnecting...';
                    statusElement.className = 'text-xs text-red-500';
                    statusElement.classList.remove('hidden');
                    break;
                case 'error':
                    statusElement.textContent = 'Connection error';
                    statusElement.className = 'text-xs text-red-500';
                    statusElement.classList.remove('hidden');
                    break;
            }
        }
    }
    
    
    getCsrfToken() {
        // First try to get from cookie
        const csrfCookie = document.cookie
            .split('; ')
            .find(row => row.startsWith('csrftoken='))
            ?.split('=')[1];
        
        if (csrfCookie) {
            return csrfCookie;
        }
        
        // Fallback to form token or meta tag
        return document.querySelector('[name=csrfmiddlewaretoken]')?.value || 
               document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ||
               '';
    }
    
    // === MOBILE NAVIGATION ===
    
    setupMobileNavigation() {
        const backButton = document.getElementById('backToChatList');
        if (backButton) {
            backButton.addEventListener('click', () => {
                this.showChatList();
            });
        }
        
        // Conversation selection is now handled by event delegation in setupConversationSelection()
        
        // Handle window resize
        window.addEventListener('resize', () => {
            this.handleResize();
        });
        
        // Initial layout adjustment
        this.handleResize();
    }
    
    isMobile() {
        return window.innerWidth < 768; // md breakpoint
    }
    
    showChatList() {
        const conversationsPanel = document.getElementById('conversationsPanel');
        const chatPanel = document.getElementById('chatPanel');
        
        if (conversationsPanel && chatPanel) {
            conversationsPanel.classList.remove('hidden');
            conversationsPanel.classList.add('flex');
            chatPanel.classList.add('hidden');
            chatPanel.classList.remove('flex');
        }
    }
    
    showChatPanel() {
        const conversationsPanel = document.getElementById('conversationsPanel');
        const chatPanel = document.getElementById('chatPanel');
        
        if (conversationsPanel && chatPanel && this.isMobile()) {
            conversationsPanel.classList.add('hidden');
            conversationsPanel.classList.remove('flex');
            chatPanel.classList.remove('hidden');
            chatPanel.classList.add('flex');
        }
    }
    
    handleResize() {
        const conversationsPanel = document.getElementById('conversationsPanel');
        const chatPanel = document.getElementById('chatPanel');
        
        if (!this.isMobile()) {
            // Desktop: show both panels
            if (conversationsPanel && chatPanel) {
                conversationsPanel.classList.remove('hidden');
                conversationsPanel.classList.add('flex');
                chatPanel.classList.remove('hidden');
                chatPanel.classList.add('flex');
            }
        } else {
            // Mobile: show appropriate panel based on current state
            if (this.conversationId) {
                this.showChatPanel();
            } else {
                this.showChatList();
            }
        }
        
        // Adjust message container height on mobile keyboard
        if (this.isMobile()) {
            this.adjustForKeyboard();
        }
    }
    
    adjustForKeyboard() {
        const messageInput = document.getElementById('messageInput');
        if (messageInput) {
            messageInput.addEventListener('focus', () => {
                // Add small delay to allow keyboard to open
                setTimeout(() => {
                    this.scrollToBottom();
                }, 300);
            });
        }
    }
    
    // === ADVANCED REAL-TIME FEATURES ===
    
    setupMessageActions(messageDiv) {
        const reactionBtn = messageDiv.querySelector('.reaction-btn');
        const editBtn = messageDiv.querySelector('.edit-btn');
        const deleteBtn = messageDiv.querySelector('.delete-btn');
        
        if (reactionBtn) {
            reactionBtn.addEventListener('click', (e) => {
                this.showReactionPicker(e.target.dataset.messageId, e.target);
            });
        }
        
        if (editBtn) {
            editBtn.addEventListener('click', (e) => {
                this.startEditingMessage(e.target.dataset.messageId);
            });
        }
        
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                this.deleteMessage(e.target.dataset.messageId);
            });
        }
    }
    
    showReactionPicker(messageId, button) {
        const commonEmojis = ['👍', '❤️', '😂', '😮', '😢', '😡', '👎'];
        
        // Remove existing picker
        const existingPicker = document.getElementById('reactionPicker');
        if (existingPicker) {
            existingPicker.remove();
            return;
        }
        
        const picker = document.createElement('div');
        picker.id = 'reactionPicker';
        picker.className = 'absolute bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-2 z-50 flex space-x-1';
        picker.style.bottom = '100%';
        picker.style.left = '0';
        picker.style.marginBottom = '5px';
        
        commonEmojis.forEach(emoji => {
            const emojiBtn = document.createElement('button');
            emojiBtn.textContent = emoji;
            emojiBtn.className = 'text-xl hover:bg-gray-100 dark:hover:bg-gray-700 rounded p-1 transition-colors';
            emojiBtn.addEventListener('click', () => {
                this.sendReaction(messageId, emoji);
                picker.remove();
            });
            picker.appendChild(emojiBtn);
        });
        
        button.parentElement.style.position = 'relative';
        button.parentElement.appendChild(picker);
        
        // Close picker when clicking outside
        setTimeout(() => {
            document.addEventListener('click', function closePicker(e) {
                if (!picker.contains(e.target) && e.target !== button) {
                    picker.remove();
                    document.removeEventListener('click', closePicker);
                }
            });
        }, 100);
    }
    
    sendReaction(messageId, emoji) {
        if (this.chatSocket && this.chatSocket.readyState === WebSocket.OPEN) {
            this.chatSocket.send(JSON.stringify({
                type: 'message_reaction',
                message_id: messageId,
                emoji: emoji,
                action: 'add'
            }));
        }
    }
    
    handleMessageReaction(data) {
        const messageDiv = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageDiv) {
            const reactionsDiv = messageDiv.querySelector('.message-reactions');
            this.updateReactionsDisplay(reactionsDiv, data.reactions);
        }
    }
    
    updateReactionsDisplay(reactionsDiv, reactions) {
        if (!reactions || Object.keys(reactions).length === 0) {
            reactionsDiv.style.display = 'none';
            return;
        }
        
        reactionsDiv.style.display = 'block';
        reactionsDiv.innerHTML = '';
        
        Object.entries(reactions).forEach(([emoji, users]) => {
            const reactionSpan = document.createElement('span');
            reactionSpan.className = 'inline-flex items-center bg-gray-100 dark:bg-gray-700 rounded-full px-2 py-1 text-xs mr-1 mb-1';
            reactionSpan.innerHTML = `${emoji} ${users.length}`;
            reactionSpan.title = users.map(u => u.username).join(', ');
            reactionsDiv.appendChild(reactionSpan);
        });
    }
    
    startEditingMessage(messageId) {
        const messageDiv = document.querySelector(`[data-message-id="${messageId}"]`);
        const messageTextDiv = messageDiv.querySelector('.message-text');
        const messageContentP = messageTextDiv?.querySelector('.message-content') || messageTextDiv?.querySelector('p');
        
        if (!messageContentP) {
            console.error('Could not find message content to edit');
            return;
        }
        
        const originalText = messageContentP.textContent;
        
        // Replace text with input
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalText;
        input.className = 'w-full bg-transparent border-b border-gray-300 dark:border-gray-600 focus:outline-none focus:border-blue-500 p-1';
        
        messageContentP.replaceWith(input);
        input.focus();
        input.select();
        
        const saveEdit = () => {
            const newText = input.value.trim();
            if (newText && newText !== originalText) {
                this.sendMessageEdit(messageId, newText);
            } else {
                // Cancel edit - restore original text
                const newP = document.createElement('p');
                newP.className = 'message-content';
                newP.textContent = originalText;
                input.replaceWith(newP);
            }
        };
        
        const cancelEdit = () => {
            // Cancel - restore original text
            const newP = document.createElement('p');
            newP.className = 'message-content';
            newP.textContent = originalText;
            input.replaceWith(newP);
        };
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveEdit();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
            }
        });
        
        input.addEventListener('blur', saveEdit);
    }
    
    async sendMessageEdit(messageId, newContent) {
        try {
            // First try API edit for persistent update
            const response = await fetch(`/edit-message/${messageId}/`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': this.getCsrfToken()
                },
                body: JSON.stringify({ content: newContent })
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Also send WebSocket notification for real-time update
                if (this.chatSocket && this.chatSocket.readyState === WebSocket.OPEN) {
                    this.chatSocket.send(JSON.stringify({
                        type: 'message_edit',
                        message_id: messageId,
                        content: newContent
                    }));
                }
            } else {
                console.error('Failed to edit message:', data.error);
                // Revert the UI change
                this.revertMessageEdit(messageId);
            }
        } catch (error) {
            console.error('Error editing message:', error);
            // Revert the UI change
            this.revertMessageEdit(messageId);
        }
    }
    
    revertMessageEdit(messageId) {
        // Find the message and reload the page or revert the edit
        // For simplicity, we'll just reload the conversation
        window.location.reload();
    }
    
    handleMessageEdit(data) {
        const messageDiv = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageDiv) {
            const messageTextDiv = messageDiv.querySelector('.message-text');
            const messageContentP = messageTextDiv?.querySelector('.message-content') || messageTextDiv?.querySelector('p');
            const timestampArea = messageDiv.querySelector('.text-xs');
            
            if (messageContentP) {
                // Update content
                messageContentP.textContent = data.new_content;
                
                // Add edited indicator if not already present
                if (!messageTextDiv.querySelector('.italic')) {
                    const editedSpan = document.createElement('span');
                    editedSpan.className = 'text-xs text-gray-500 dark:text-gray-400 italic ml-2';
                    editedSpan.textContent = '(edited)';
                    messageTextDiv.appendChild(editedSpan);
                }
            }
        }
    }
    
    deleteMessage(messageId) {
        // Show confirmation modal instead of direct delete
        this.showDeleteMessageModal(messageId);
    }
    
    async confirmDeleteMessage(messageId) {
        try {
            // First try API delete for persistent deletion
            const response = await fetch(`/delete-message/${messageId}/`, {
                method: 'DELETE',
                headers: {
                    'X-CSRFToken': this.getCsrfToken()
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Also send WebSocket notification for real-time update
                if (this.chatSocket && this.chatSocket.readyState === WebSocket.OPEN) {
                    this.chatSocket.send(JSON.stringify({
                        type: 'message_delete',
                        message_id: messageId
                    }));
                }
            } else {
                console.error('Failed to delete message:', data.error);
            }
        } catch (error) {
            console.error('Error deleting message:', error);
        }
    }
    
    async confirmDeleteConversation(conversationId) {
        try {
            const response = await fetch(`/delete-conversation/${conversationId}/`, {
                method: 'DELETE',
                headers: {
                    'X-CSRFToken': this.getCsrfToken()
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Redirect to home page
                window.location.href = '/';
            } else {
                console.error('Failed to delete conversation:', data.error);
            }
        } catch (error) {
            console.error('Error deleting conversation:', error);
        }
    }
    
    handleMessageDelete(data) {
        const messageDiv = document.querySelector(`[data-message-id="${data.message_id}"]`);
        if (messageDiv) {
            // Update message to show as deleted instead of removing it
            const messageBubble = messageDiv.querySelector('.message-bubble');
            const messageText = messageDiv.querySelector('.message-text');
            const messageActions = messageDiv.querySelector('.message-actions-btn')?.parentElement;
            
            if (messageBubble && messageText) {
                // Update styling to show deleted message
                messageBubble.className = messageBubble.className.replace(
                    /bg-whatsapp-light-green|bg-white|dark:bg-gray-700/g, 
                    'bg-gray-200 dark:bg-gray-600'
                ).replace(
                    /text-gray-800|text-gray-900|dark:text-white/g,
                    'text-gray-500 dark:text-gray-400'
                );
                messageBubble.classList.add('italic');
                
                // Update message text
                messageText.innerHTML = '<p class="text-sm">This message was deleted</p>';
                
                // Remove message actions
                if (messageActions) {
                    messageActions.remove();
                }
                
                // Remove status indicators for deleted messages
                const statusSpan = messageDiv.querySelector('.message-status');
                if (statusSpan) {
                    statusSpan.remove();
                }
            }
        }
    }
    
    handleUserActivity(data) {
        // Update user activity status in the UI
        // Could add visual indicators for user activity here if needed
    }
    
    playReceiveSound() {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.setValueAtTime(600, audioContext.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(300, audioContext.currentTime + 0.15);
            
            gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.15);
        } catch (e) {
            // Silently fail if Web Audio API is not supported
        }
    }
    
    showBrowserNotification(data) {
        // STRICT CHECK: Don't show any notifications until explicitly allowed
        if (!this.allowNotifications) {
            return;
        }
        
        // Check if notifications are supported and permission granted
        if (!('Notification' in window) || Notification.permission !== 'granted') {
            return;
        }
        
        // Don't show notification for own messages
        if (data.user_id === this.currentUserId) {
            return;
        }
        
        // Only show if page is not visible
        if (!document.hidden) {
            return;
        }
        
        // Don't show notifications until connection is fully ready
        if (!this.connectionReady || !this.initialLoadComplete) {
            return;
        }
        
        // Don't show notifications for old messages
        if (data.timestamp) {
            const messageTime = new Date(data.timestamp);
            const sessionStart = new Date(this.sessionStartTime.getTime());
            // Only show notification if message was sent after this session started
            // Add 10 second buffer to be extra safe
            if (messageTime < new Date(sessionStart.getTime() - 10000)) {
                return;
            }
        }
        
        // Additional check: Only show for very recent messages (within last 30 seconds)
        if (data.timestamp) {
            const messageTime = new Date(data.timestamp);
            const now = new Date();
            const timeDiff = (now - messageTime) / 1000; // seconds
            if (timeDiff > 30) {
                return; // Don't notify for messages older than 30 seconds
            }
        }
        
        const notification = new Notification(`${data.username}`, {
            body: data.message,
            icon: '/static/img/chat-icon.png', // Add a chat icon if you have one
            tag: 'chat-message'
        });
        
        // Auto close after 5 seconds
        setTimeout(() => {
            notification.close();
        }, 5000);
        
        // Click to focus window
        notification.onclick = () => {
            window.focus();
            notification.close();
        };
    }
    
    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }
    
    // === FILE UPLOAD FUNCTIONALITY ===
    
    setupFileUpload() {
        console.log('🔧 Setting up file upload functionality...');
        
        // Retry mechanism to ensure elements are available
        const initializeFileUpload = (attempt = 1) => {
            const attachBtn = document.getElementById('attachBtn');
            const fileInput = document.getElementById('fileInput');
            const removeFileBtn = document.getElementById('removeFile');
            
            console.log(`📎 Attempt ${attempt} - Elements found:`, {
                attachBtn: !!attachBtn,
                fileInput: !!fileInput,
                removeFileBtn: !!removeFileBtn
            });
            
            if (attachBtn && fileInput) {
                console.log('✅ File upload elements found, setting up event listeners...');
                
                // Clear any existing listeners to prevent duplicates
                const newAttachBtn = attachBtn.cloneNode(true);
                attachBtn.parentNode.replaceChild(newAttachBtn, attachBtn);
                
                // Attach button click opens file dialog
                newAttachBtn.addEventListener('click', (e) => {
                    console.log('📎 Attach button clicked!');
                    e.preventDefault();
                    e.stopPropagation();
                    
                    // Test if file input can be triggered
                    try {
                        fileInput.click();
                        console.log('✅ File dialog triggered');
                    } catch (error) {
                        console.error('❌ Error triggering file dialog:', error);
                    }
                });
            
                // Handle file selection
                fileInput.addEventListener('change', (e) => {
                    console.log('📁 File input changed! Files:', e.target.files);
                    const file = e.target.files[0];
                    if (file) {
                        console.log('📄 File selected:', {
                            name: file.name,
                            size: file.size,
                            type: file.type
                        });
                        this.handleFileSelection(file);
                    } else {
                        console.log('⚠ No file selected');
                    }
                });
                
                // Remove file button
                if (removeFileBtn) {
                    removeFileBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        this.clearFilePreview();
                    });
                }
                
                // Drag and drop functionality
                this.setupDragAndDrop();
                
                console.log('✅ File upload initialization completed successfully!');
                
            } else {
                console.error(`❌ Attempt ${attempt} - File upload elements missing!`);
                if (!attachBtn) console.error('Missing: attachBtn (id="attachBtn")');
                if (!fileInput) console.error('Missing: fileInput (id="fileInput")');
                
                // Retry up to 3 times with increasing delay
                if (attempt < 3) {
                    console.log(`🔁 Retrying in ${attempt * 500}ms...`);
                    setTimeout(() => initializeFileUpload(attempt + 1), attempt * 500);
                } else {
                    console.error('❌ Failed to initialize file upload after 3 attempts');
                }
            }
        };
        
        // Start initialization
        initializeFileUpload();
        
        // Fallback: Add a global click handler as backup
        document.addEventListener('click', (e) => {
            if (e.target && (e.target.id === 'attachBtn' || e.target.closest('#attachBtn'))) {
                console.log('🔄 Fallback attach button handler triggered');
                const fileInput = document.getElementById('fileInput');
                if (fileInput) {
                    fileInput.click();
                    console.log('🔄 Fallback file dialog opened');
                } else {
                    console.error('🔄 Fallback failed - no file input found');
                }
            }
        });
    }
    
    handleFileSelection(file) {
        console.log('🔄 Processing file selection:', file.name);
        
        // Validate file size (max 10MB)
        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
            console.error('❌ File too large:', file.size, 'bytes');
            alert('File is too large. Maximum size is 10MB.');
            return;
        }
        
        // Store selected file
        this.selectedFile = file;
        
        // Show file preview
        this.showFilePreview(file);
    }
    
    showFilePreview(file) {
        console.log('📄 Showing file preview for:', file.name);
        
        const filePreview = document.getElementById('filePreview');
        const fileName = document.getElementById('fileName');
        const fileSize = document.getElementById('fileSize');
        const fileIcon = document.getElementById('fileIcon');
        const imagePreview = document.getElementById('imagePreview');
        
        console.log('📄 Preview elements check:', {
            filePreview: !!filePreview,
            fileName: !!fileName,
            fileSize: !!fileSize,
            fileIcon: !!fileIcon,
            imagePreview: !!imagePreview
        });
        
        if (!filePreview || !fileName || !fileSize || !fileIcon) {
            console.error('❌ File preview elements not found');
            if (!filePreview) console.error('Missing: filePreview (id="filePreview")');
            if (!fileName) console.error('Missing: fileName (id="fileName")');
            if (!fileSize) console.error('Missing: fileSize (id="fileSize")');
            if (!fileIcon) console.error('Missing: fileIcon (id="fileIcon")');
            return;
        }
        
        // Set file name and size
        fileName.textContent = file.name;
        fileSize.textContent = this.formatFileSize(file.size);
        
        // Set file icon based on type
        fileIcon.innerHTML = this.getFileIcon(file);
        
        // Show image preview if it's an image
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = imagePreview.querySelector('img');
                if (img) {
                    img.src = e.target.result;
                    imagePreview.classList.remove('hidden');
                }
            };
            reader.readAsDataURL(file);
        } else {
            imagePreview.classList.add('hidden');
        }
        
        // Show the preview container
        console.log('✅ Showing file preview container');
        filePreview.classList.remove('hidden');
        console.log('✅ File preview displayed successfully!');
        
        // Debug: Check if preview is actually visible
        setTimeout(() => {
            const isVisible = !filePreview.classList.contains('hidden');
            console.log('🔍 Preview visibility check:', isVisible);
        }, 100);
    }
    
    clearFilePreview() {
        const filePreview = document.getElementById('filePreview');
        const fileInput = document.getElementById('fileInput');
        const imagePreview = document.getElementById('imagePreview');
        
        if (filePreview) {
            filePreview.classList.add('hidden');
        }
        
        if (imagePreview) {
            imagePreview.classList.add('hidden');
        }
        
        if (fileInput) {
            fileInput.value = '';
        }
        
        this.selectedFile = null;
    }
    
    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    getFileIcon(file) {
        const extension = file.name.split('.').pop().toLowerCase();
        const type = file.type.toLowerCase();
        
        if (type.startsWith('image/')) {
            return `<svg class="w-8 h-8 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd"></path>
                    </svg>`;
        } else if (extension === 'pdf') {
            return `<svg class="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"></path>
                    </svg>`;
        } else if (type.startsWith('audio/')) {
            return `<svg class="w-8 h-8 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"></path>
                    </svg>`;
        } else if (type.startsWith('video/')) {
            return `<svg class="w-8 h-8 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h6l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path>
                        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m7 10 5 3V7l-5 3z"></path>
                    </svg>`;
        } else if (['zip', 'rar', '7z'].includes(extension)) {
            return `<svg class="w-8 h-8 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"></path>
                    </svg>`;
        } else {
            return `<svg class="w-8 h-8 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"></path>
                    </svg>`;
        }
    }
    
    setupDragAndDrop() {
        const messagesContainer = document.getElementById('messagesContainer');
        const messageInput = document.getElementById('messageInput');
        
        if (!messagesContainer && !messageInput) return;
        
        const targets = [messagesContainer, messageInput].filter(Boolean);
        
        targets.forEach(target => {
            target.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.stopPropagation();
                target.classList.add('drag-over');
            });
            
            target.addEventListener('dragleave', (e) => {
                e.preventDefault();
                e.stopPropagation();
                target.classList.remove('drag-over');
            });
            
            target.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                target.classList.remove('drag-over');
                
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    this.handleFileSelection(files[0]);
                }
            });
        });
    }
    
    async sendFileMessage() {
        if (!this.selectedFile) {
            console.error('No file selected');
            return;
        }
        
        if (!this.chatSocket || this.chatSocket.readyState !== WebSocket.OPEN) {
            alert('Not connected to chat server');
            return;
        }
        
        const messageInput = document.getElementById('messageInput');
        const textContent = messageInput ? messageInput.value.trim() : '';
        
        try {
            // Show uploading indicator
            this.showUploadingIndicator();
            
            // Create FormData for file upload
            const formData = new FormData();
            formData.append('file', this.selectedFile);
            formData.append('content', textContent);
            formData.append('conversation_id', this.conversationId);
            
            // Upload file via HTTP POST
            const response = await fetch('/upload-file/', {
                method: 'POST',
                headers: {
                    'X-CSRFToken': this.getCsrfToken()
                },
                body: formData
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Send WebSocket message with file info
                const messageData = {
                    'type': 'file_message',
                    'message': textContent,
                    'message_id': data.message_id,
                    'file_name': data.file_name,
                    'file_url': data.file_url,
                    'file_size': data.file_size,
                    'is_image': data.is_image
                };
                
                this.chatSocket.send(JSON.stringify(messageData));
                
                // Clear input and file preview
                if (messageInput) messageInput.value = '';
                this.clearFilePreview();
                this.stopTyping();
                
                // Enable notifications
                this.requestNotificationPermission();
                setTimeout(() => {
                    this.allowNotifications = true;
                }, 1000);
                
            } else {
                throw new Error(data.error || 'File upload failed');
            }
            
        } catch (error) {
            console.error('Error uploading file:', error);
            alert('Failed to upload file: ' + error.message);
        } finally {
            this.hideUploadingIndicator();
        }
    }
    
    showUploadingIndicator() {
        const sendBtn = document.getElementById('sendBtn');
        if (sendBtn) {
            sendBtn.innerHTML = `
                <svg class="w-4 h-4 md:w-5 md:h-5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
            `;
            sendBtn.disabled = true;
        }
    }
    
    hideUploadingIndicator() {
        const sendBtn = document.getElementById('sendBtn');
        if (sendBtn) {
            sendBtn.innerHTML = `
                <svg class="w-4 h-4 md:w-5 md:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
                </svg>
            `;
            sendBtn.disabled = false;
        }
    }
    
    createFileMessageElement(data) {
        const fileContainer = document.createElement('div');
        
        if (data.is_image && data.file_url) {
            // Image message
            fileContainer.className = 'file-message image-message';
            const img = document.createElement('img');
            img.src = data.file_url;
            img.alt = data.file_name || 'Image';
            img.className = 'max-w-full max-h-64 rounded-lg cursor-pointer hover:opacity-90 transition-opacity';
            img.onclick = () => window.open(data.file_url, '_blank');
            fileContainer.appendChild(img);
        } else {
            // Regular file message
            fileContainer.className = 'file-message flex items-center space-x-3 p-3 bg-gray-50 dark:bg-gray-600 rounded-lg';
            
            // File icon
            const iconDiv = document.createElement('div');
            iconDiv.className = 'file-icon text-gray-500 dark:text-gray-400';
            iconDiv.innerHTML = this.getFileIconByName(data.file_name);
            
            // File info
            const infoDiv = document.createElement('div');
            infoDiv.className = 'file-info flex-1';
            
            const nameP = document.createElement('p');
            nameP.className = 'font-medium text-sm text-gray-900 dark:text-white';
            nameP.textContent = data.file_name || 'Unknown file';
            
            const sizeP = document.createElement('p');
            sizeP.className = 'text-xs text-gray-500 dark:text-gray-400';
            sizeP.textContent = data.file_size || '';
            
            infoDiv.appendChild(nameP);
            infoDiv.appendChild(sizeP);
            
            // Download button
            const downloadLink = document.createElement('a');
            downloadLink.href = data.file_url;
            downloadLink.download = data.file_name || 'download';
            downloadLink.className = 'download-btn p-2 bg-gray-200 dark:bg-gray-500 hover:bg-gray-300 dark:hover:bg-gray-400 rounded-full transition-colors';
            downloadLink.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                </svg>
            `;
            
            fileContainer.appendChild(iconDiv);
            fileContainer.appendChild(infoDiv);
            fileContainer.appendChild(downloadLink);
        }
        
        return fileContainer;
    }
    
    getFileIconByName(fileName) {
        if (!fileName) return this.getGenericFileIcon();
        
        const extension = fileName.split('.').pop().toLowerCase();
        
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(extension)) {
            return `<svg class="w-8 h-8 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd"></path>
                    </svg>`;
        } else if (extension === 'pdf') {
            return `<svg class="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"></path>
                    </svg>`;
        } else if (['mp3', 'wav', 'ogg', 'aac'].includes(extension)) {
            return `<svg class="w-8 h-8 text-purple-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M18 3a1 1 0 00-1.196-.98l-10 2A1 1 0 006 5v9.114A4.369 4.369 0 005 14c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V7.82l8-1.6v5.894A4.37 4.37 0 0015 12c-1.657 0-3 .895-3 2s1.343 2 3 2 3-.895 3-2V3z"></path>
                    </svg>`;
        } else if (['mp4', 'avi', 'mov', 'webm'].includes(extension)) {
            return `<svg class="w-8 h-8 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M2 6a2 2 0 012-2h6l2 2h6a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"></path>
                        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m7 10 5 3V7l-5 3z"></path>
                    </svg>`;
        } else if (['zip', 'rar', '7z'].includes(extension)) {
            return `<svg class="w-8 h-8 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"></path>
                    </svg>`;
        } else {
            return this.getGenericFileIcon();
        }
    }
    
    getGenericFileIcon() {
        return `<svg class="w-8 h-8 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"></path>
                </svg>`;
    }
}

// Simple emoji picker
class EmojiPicker {
    constructor() {
        this.emojis = [
            '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
            '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
            '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩',
            '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣',
            '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
            '👍', '👎', '👌', '✊', '✋', '🤚', '👋', '🤝', '🙏', '❤️',
            '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️',
            '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️'
        ];
        
        this.setupEmojiPicker();
    }
    
    setupEmojiPicker() {
        const emojiBtn = document.getElementById('emojiBtn');
        const messageInput = document.getElementById('messageInput');
        
        if (emojiBtn && messageInput) {
            emojiBtn.addEventListener('click', () => {
                this.toggleEmojiPicker(messageInput);
            });
        }
    }
    
    toggleEmojiPicker(input) {
        // Remove existing picker if present
        const existingPicker = document.getElementById('emojiPickerContainer');
        if (existingPicker) {
            existingPicker.remove();
            return;
        }
        
        // Create emoji picker container
        const pickerContainer = document.createElement('div');
        pickerContainer.id = 'emojiPickerContainer';
        pickerContainer.className = 'absolute bottom-16 left-0 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-4 z-50';
        pickerContainer.style.width = '300px';
        pickerContainer.style.height = '200px';
        pickerContainer.style.overflowY = 'auto';
        
        // Create emoji grid
        const emojiGrid = document.createElement('div');
        emojiGrid.className = 'grid grid-cols-8 gap-2';
        
        this.emojis.forEach(emoji => {
            const emojiBtn = document.createElement('button');
            emojiBtn.textContent = emoji;
            emojiBtn.className = 'text-xl hover:bg-gray-100 dark:hover:bg-gray-700 rounded p-1 transition-colors';
            emojiBtn.addEventListener('click', () => {
                input.value += emoji;
                input.focus();
                pickerContainer.remove();
            });
            emojiGrid.appendChild(emojiBtn);
        });
        
        pickerContainer.appendChild(emojiGrid);
        
        // Position and add to DOM
        const emojiButton = document.getElementById('emojiBtn');
        const inputContainer = emojiButton.parentElement;
        inputContainer.style.position = 'relative';
        inputContainer.appendChild(pickerContainer);
        
        // Close picker when clicking outside
        setTimeout(() => {
            document.addEventListener('click', function closeEmojiPicker(e) {
                if (!pickerContainer.contains(e.target) && e.target !== emojiButton) {
                    pickerContainer.remove();
                    document.removeEventListener('click', closeEmojiPicker);
                }
            });
        }, 100);
    }
}

// Initialize the chat app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('🚀 DOM Content Loaded - Initializing ChatApp...');
    
    try {
        const chatApp = new ChatApp();
        console.log('✅ ChatApp initialized successfully');
        
        const emojiPicker = new EmojiPicker();
        console.log('✅ EmojiPicker initialized successfully');
        
    } catch (error) {
        console.error('❌ Error during initialization:', error);
    }
    
    // Additional debugging - check if elements exist after DOM load
    setTimeout(() => {
        console.log('🔍 Post-init element check:', {
            attachBtn: !!document.getElementById('attachBtn'),
            fileInput: !!document.getElementById('fileInput'),
            filePreview: !!document.getElementById('filePreview'),
            fileName: !!document.getElementById('fileName'),
            fileSize: !!document.getElementById('fileSize'),
            fileIcon: !!document.getElementById('fileIcon')
        });
    }, 1000);
});
