// WebRTC Client for Audio/Video Calls
class WebRTCClient {
    constructor(chatApp) {
        this.chatApp = chatApp;
        this.userSocket = null; // Separate socket for user notifications
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.isInitiator = false;
        this.currentCall = null;
        
        // WebRTC configuration with STUN servers
        this.rtcConfiguration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };
        
        // Media constraints
        this.audioConstraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: false
        };
        
        this.videoConstraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            },
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 }
            }
        };
        
        this.isCallActive = false;
        this.callStartTime = null;
        
        this.init();
    }
    
    init() {
        console.log('WebRTC Client initialized');
        
        // Check for WebRTC support
        if (!this.isWebRTCSupported()) {
            console.error('WebRTC is not supported in this browser');
            this.showError('Your browser does not support video/audio calls. Please use a modern browser.');
            return;
        }
        
        this.setupEventListeners();
        this.connectUserSocket();
    }
    
    isWebRTCSupported() {
        return !!(navigator.getUserMedia || navigator.webkitGetUserMedia || 
                  navigator.mozGetUserMedia || navigator.msGetUserMedia ||
                  (navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
    }
    
    setupEventListeners() {
        // Listen for call-related WebSocket messages
        if (this.chatApp && this.chatApp.chatSocket) {
            // Override the handleWebSocketMessage method to handle call events
            const originalHandler = this.chatApp.handleWebSocketMessage.bind(this.chatApp);
            this.chatApp.handleWebSocketMessage = (data) => {
                if (this.handleCallMessage(data)) {
                    return; // Message was handled by WebRTC client
                }
                originalHandler(data); // Pass to original handler
            };
        }
    }
    
    handleCallMessage(data) {
        switch (data.type) {
            case 'incoming_call':
                this.handleIncomingCall(data);
                return true;
                
            case 'call_accepted':
                this.handleCallAccepted(data);
                return true;
                
            case 'call_rejected':
                this.handleCallRejected(data);
                return true;
                
            case 'call_ended':
                this.handleCallEnded(data);
                return true;
                
            case 'webrtc_offer':
                this.handleWebRTCOffer(data);
                return true;
                
            case 'webrtc_answer':
                this.handleWebRTCAnswer(data);
                return true;
                
            case 'webrtc_ice_candidate':
                this.handleWebRTCIceCandidate(data);
                return true;
                
            default:
                return false; // Message not handled
        }
    }
    
    // Initiate a call
    async initiateCall(calleeId, callType = 'audio') {
        try {
            if (this.isCallActive) {
                this.showError('Another call is already in progress');
                return;
            }
            
            console.log(`Initiating ${callType} call to user ${calleeId}`);
            
            // Get user media first
            await this.getUserMedia(callType === 'video');
            
            // Send call initiation through WebSocket
            if (this.chatApp.chatSocket && this.chatApp.chatSocket.readyState === WebSocket.OPEN) {
                this.chatApp.chatSocket.send(JSON.stringify({
                    type: 'call_initiate',
                    callee_id: calleeId,
                    call_type: callType
                }));
                
                this.isInitiator = true;
                this.showOutgoingCallUI(calleeId, callType);
            } else {
                throw new Error('WebSocket connection not available');
            }
            
        } catch (error) {
            console.error('Error initiating call:', error);
            this.showError('Failed to start call: ' + error.message);
            this.cleanup();
        }
    }
    
    // Get user media (camera/microphone)
    async getUserMedia(includeVideo = false) {
        try {
            const constraints = includeVideo ? this.videoConstraints : this.audioConstraints;
            
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            } else {
                // Fallback for older browsers
                const getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || 
                                   navigator.mozGetUserMedia || navigator.msGetUserMedia;
                
                this.localStream = await new Promise((resolve, reject) => {
                    getUserMedia.call(navigator, constraints, resolve, reject);
                });
            }
            
            console.log('Got local media stream');
            this.displayLocalVideo();
            
        } catch (error) {
            console.error('Error accessing media devices:', error);
            throw new Error('Could not access camera/microphone. Please check permissions.');
        }
    }
    
    // Handle incoming call
    handleIncomingCall(data) {
        console.log('🔔 WebRTC: Incoming call notification received:', data);
        console.log('🔔 Caller:', data.caller_name, 'Type:', data.call_type);
        
        if (this.isCallActive) {
            console.log('🔔 Already in a call - auto-rejecting');
            // Auto-reject if already in a call
            this.rejectCall(data.call_id, 'busy');
            return;
        }
        
        this.currentCall = {
            call_id: data.call_id,
            caller_id: data.caller_id,
            caller_name: data.caller_name,
            call_type: data.call_type,
            conversation_id: data.conversation_id
        };
        
        console.log('🔔 Current call data set:', this.currentCall);
        console.log('🔔 Attempting to show incoming call UI...');
        
        this.showIncomingCallUI(data);
        
        console.log('🔔 showIncomingCallUI called');
    }
    
    // Accept incoming call
    async acceptCall(callId) {
        try {
            console.log('Accepting call:', callId);
            
            // Get user media
            const isVideo = this.currentCall && this.currentCall.call_type === 'video';
            await this.getUserMedia(isVideo);
            
            // Send accept through WebSocket
            if (this.chatApp.chatSocket && this.chatApp.chatSocket.readyState === WebSocket.OPEN) {
                this.chatApp.chatSocket.send(JSON.stringify({
                    type: 'call_accept',
                    call_id: callId
                }));
                
                this.isInitiator = false;
                this.startCall(callId);
                this.hideIncomingCallUI();
                this.showCallUI();
            }
            
        } catch (error) {
            console.error('Error accepting call:', error);
            this.showError('Failed to accept call: ' + error.message);
            this.rejectCall(callId);
        }
    }
    
    // Reject incoming call
    rejectCall(callId, reason = 'declined') {
        console.log('Rejecting call:', callId, 'Reason:', reason);
        
        if (this.chatApp.chatSocket && this.chatApp.chatSocket.readyState === WebSocket.OPEN) {
            this.chatApp.chatSocket.send(JSON.stringify({
                type: 'call_reject',
                call_id: callId
            }));
        }
        
        this.hideIncomingCallUI();
        this.cleanup();
    }
    
    // End active call
    endCall() {
        console.log('Ending call');
        
        if (this.currentCall) {
            if (this.chatApp.chatSocket && this.chatApp.chatSocket.readyState === WebSocket.OPEN) {
                this.chatApp.chatSocket.send(JSON.stringify({
                    type: 'call_end',
                    call_id: this.currentCall.call_id
                }));
            }
        }
        
        this.cleanup();
        this.hideCallUI();
    }
    
    // Start WebRTC peer connection
    async startCall(callId) {
        try {
            console.log('Starting WebRTC call:', callId);
            
            this.currentCall = this.currentCall || { call_id: callId };
            this.isCallActive = true;
            this.callStartTime = new Date();
            
            // Create peer connection
            this.peerConnection = new RTCPeerConnection(this.rtcConfiguration);
            
            // Add local stream to peer connection
            if (this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
            
            // Handle remote stream
            this.peerConnection.ontrack = (event) => {
                console.log('Received remote stream');
                this.remoteStream = event.streams[0];
                this.displayRemoteVideo();
            };
            
            // Handle ICE candidates
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    console.log('Sending ICE candidate');
                    this.sendSignalingMessage('webrtc_ice_candidate', {
                        call_id: callId,
                        candidate: event.candidate
                    });
                }
            };
            
            // Handle connection state changes
            this.peerConnection.onconnectionstatechange = () => {
                console.log('Connection state:', this.peerConnection.connectionState);
                
                if (this.peerConnection.connectionState === 'connected') {
                    console.log('WebRTC connection established');
                    this.updateCallStatus('connected');
                } else if (this.peerConnection.connectionState === 'disconnected' || 
                          this.peerConnection.connectionState === 'failed') {
                    console.log('WebRTC connection lost');
                    this.endCall();
                }
            };
            
            // If we're the initiator, create and send offer
            if (this.isInitiator) {
                await this.createAndSendOffer(callId);
            }
            
        } catch (error) {
            console.error('Error starting call:', error);
            this.showError('Failed to establish call connection');
            this.endCall();
        }
    }
    
    // Create and send WebRTC offer
    async createAndSendOffer(callId) {
        try {
            console.log('Creating WebRTC offer');
            
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.sendSignalingMessage('webrtc_offer', {
                call_id: callId,
                offer: offer
            });
            
        } catch (error) {
            console.error('Error creating offer:', error);
            throw error;
        }
    }
    
    // Handle WebRTC offer
    async handleWebRTCOffer(data) {
        try {
            console.log('Received WebRTC offer');
            
            if (!this.peerConnection) {
                await this.startCall(data.call_id);
            }
            
            await this.peerConnection.setRemoteDescription(data.offer);
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.sendSignalingMessage('webrtc_answer', {
                call_id: data.call_id,
                answer: answer
            });
            
        } catch (error) {
            console.error('Error handling WebRTC offer:', error);
            this.endCall();
        }
    }
    
    // Handle WebRTC answer
    async handleWebRTCAnswer(data) {
        try {
            console.log('Received WebRTC answer');
            
            if (this.peerConnection) {
                await this.peerConnection.setRemoteDescription(data.answer);
            }
            
        } catch (error) {
            console.error('Error handling WebRTC answer:', error);
            this.endCall();
        }
    }
    
    // Handle ICE candidate
    async handleWebRTCIceCandidate(data) {
        try {
            console.log('Received ICE candidate');
            
            if (this.peerConnection && this.peerConnection.remoteDescription) {
                await this.peerConnection.addIceCandidate(data.candidate);
            }
            
        } catch (error) {
            console.error('Error handling ICE candidate:', error);
        }
    }
    
    // Send signaling message through WebSocket
    sendSignalingMessage(type, data) {
        if (this.chatApp.chatSocket && this.chatApp.chatSocket.readyState === WebSocket.OPEN) {
            this.chatApp.chatSocket.send(JSON.stringify({
                type: type,
                ...data
            }));
        }
    }
    
    // Handle call accepted
    handleCallAccepted(data) {
        console.log('Call accepted by:', data.accepter_id);
        this.hideOutgoingCallUI();
        this.startCall(data.call_id);
        this.showCallUI();
    }
    
    // Handle call rejected
    handleCallRejected(data) {
        console.log('Call rejected by:', data.rejecter_id);
        this.hideOutgoingCallUI();
        this.showError('Call was declined');
        this.cleanup();
    }
    
    // Handle call ended
    handleCallEnded(data) {
        console.log('Call ended by:', data.ended_by);
        this.hideCallUI();
        this.cleanup();
    }
    
    // Display local video/audio
    displayLocalVideo() {
        const localVideo = document.getElementById('localVideo');
        if (localVideo && this.localStream) {
            localVideo.srcObject = this.localStream;
        }
    }
    
    // Display remote video/audio
    displayRemoteVideo() {
        const remoteVideo = document.getElementById('remoteVideo');
        if (remoteVideo && this.remoteStream) {
            remoteVideo.srcObject = this.remoteStream;
        }
    }
    
    // Mute/unmute audio
    toggleMute() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                this.updateMuteButton(audioTrack.enabled);
                return !audioTrack.enabled; // Return true if muted
            }
        }
        return false;
    }
    
    // Toggle video
    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                this.updateVideoButton(videoTrack.enabled);
                return !videoTrack.enabled; // Return true if video off
            }
        }
        return false;
    }
    
    // Update mute button state
    updateMuteButton(isEnabled) {
        const muteBtn = document.getElementById('muteBtn');
        if (muteBtn) {
            muteBtn.classList.toggle('muted', !isEnabled);
            muteBtn.title = isEnabled ? 'Mute' : 'Unmute';
        }
    }
    
    // Update video button state
    updateVideoButton(isEnabled) {
        const videoBtn = document.getElementById('videoBtn');
        if (videoBtn) {
            videoBtn.classList.toggle('video-off', !isEnabled);
            videoBtn.title = isEnabled ? 'Turn off video' : 'Turn on video';
        }
    }
    
    // Update call status
    updateCallStatus(status) {
        const statusElement = document.getElementById('callStatus');
        if (statusElement) {
            statusElement.textContent = this.getStatusText(status);
        }
    }
    
    // Get status text
    getStatusText(status) {
        const statusTexts = {
            'connecting': 'Connecting...',
            'ringing': 'Ringing...',
            'connected': 'Connected',
            'ended': 'Call ended'
        };
        return statusTexts[status] || status;
    }
    
    // Show error message
    showError(message) {
        console.error('WebRTC Error:', message);
        if (window.showToast) {
            window.showToast(message, 'error');
        } else {
            alert(message);
        }
    }
    
    // Cleanup resources
    cleanup() {
        console.log('Cleaning up WebRTC resources');
        
        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        // Close peer connection
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // Close user socket if needed for full cleanup
        if (this.userSocket && this.userSocket.readyState === WebSocket.OPEN) {
            this.userSocket.close();
        }
        
        // Reset state
        this.remoteStream = null;
        this.isCallActive = false;
        this.callStartTime = null;
        this.currentCall = null;
        this.isInitiator = false;
    }
    
    // UI Methods
    showIncomingCallUI(data) {
        console.log('📱 Show incoming call UI for:', data.caller_name);
        
        const modal = document.getElementById('incomingCallModal');
        const callerName = document.getElementById('callerName');
        const callerAvatar = document.getElementById('callerAvatar');
        const callType = document.getElementById('callType');
        const acceptBtn = document.getElementById('acceptCallBtn');
        const rejectBtn = document.getElementById('rejectCallBtn');
        
        console.log('📱 Modal elements found:');
        console.log('  - modal:', !!modal);
        console.log('  - callerName:', !!callerName);
        console.log('  - callerAvatar:', !!callerAvatar);
        console.log('  - callType:', !!callType);
        console.log('  - acceptBtn:', !!acceptBtn);
        console.log('  - rejectBtn:', !!rejectBtn);
        
        if (modal && callerName && callType) {
            console.log('📱 Setting up modal content...');
            
            callerName.textContent = data.caller_name;
            callType.textContent = `Incoming ${data.call_type} call`;
            
            console.log('📱 Modal content set - caller:', data.caller_name, 'type:', data.call_type);
            
            // Set caller avatar (you might need to fetch this from server)
            if (callerAvatar) {
                callerAvatar.src = `https://ui-avatars.com/api/?background=random&name=${encodeURIComponent(data.caller_name)}&size=80`;
                console.log('📱 Avatar set for:', data.caller_name);
            }
            
            // Remove old event listeners and add new ones
            if (acceptBtn && rejectBtn) {
                console.log('📱 Setting up button event listeners...');
                
                const newAcceptBtn = acceptBtn.cloneNode(true);
                const newRejectBtn = rejectBtn.cloneNode(true);
                acceptBtn.parentNode.replaceChild(newAcceptBtn, acceptBtn);
                rejectBtn.parentNode.replaceChild(newRejectBtn, rejectBtn);
                
                newAcceptBtn.addEventListener('click', () => {
                    console.log('📱 Accept button clicked');
                    this.acceptCall(data.call_id);
                });
                
                newRejectBtn.addEventListener('click', () => {
                    console.log('📱 Reject button clicked');
                    this.rejectCall(data.call_id);
                });
                
                console.log('📱 Event listeners attached');
            }
            
            console.log('📱 Removing hidden class from modal...');
            modal.classList.remove('hidden');
            console.log('📱 Modal should now be visible. Classes:', modal.className);
        } else {
            console.error('📱 Missing required DOM elements for incoming call modal:');
            console.error('  - modal:', modal);
            console.error('  - callerName:', callerName);
            console.error('  - callType:', callType);
        }
    }
    
    hideIncomingCallUI() {
        console.log('Hide incoming call UI');
        const modal = document.getElementById('incomingCallModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }
    
    showOutgoingCallUI(calleeId, callType) {
        console.log('Show outgoing call UI for:', calleeId, callType);
        
        const modal = document.getElementById('outgoingCallModal');
        const calleeName = document.getElementById('calleeName');
        const calleeAvatar = document.getElementById('calleeAvatar');
        const outgoingCallType = document.getElementById('outgoingCallType');
        const endBtn = document.getElementById('endOutgoingCallBtn');
        
        if (modal && calleeName && outgoingCallType) {
            // You might want to fetch the user's name from your server
            calleeName.textContent = `User ${calleeId}`;
            outgoingCallType.textContent = `${callType} call - Ringing...`;
            
            // Set callee avatar
            if (calleeAvatar) {
                calleeAvatar.src = `https://ui-avatars.com/api/?background=random&name=User${calleeId}&size=80`;
            }
            
            // Remove old event listener and add new one
            const newEndBtn = endBtn.cloneNode(true);
            endBtn.parentNode.replaceChild(newEndBtn, endBtn);
            
            newEndBtn.addEventListener('click', () => {
                this.endCall();
            });
            
            modal.classList.remove('hidden');
        }
    }
    
    hideOutgoingCallUI() {
        console.log('Hide outgoing call UI');
        const modal = document.getElementById('outgoingCallModal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }
    
    showCallUI() {
        console.log('Show call UI');
        
        const modal = document.getElementById('activeCallModal');
        const muteBtn = document.getElementById('muteBtn');
        const videoBtn = document.getElementById('videoBtn');
        const endCallBtn = document.getElementById('endCallBtn');
        
        if (modal) {
            // Remove old event listeners and add new ones
            if (muteBtn) {
                const newMuteBtn = muteBtn.cloneNode(true);
                muteBtn.parentNode.replaceChild(newMuteBtn, muteBtn);
                newMuteBtn.addEventListener('click', () => {
                    this.toggleMute();
                });
            }
            
            if (videoBtn) {
                const newVideoBtn = videoBtn.cloneNode(true);
                videoBtn.parentNode.replaceChild(newVideoBtn, videoBtn);
                newVideoBtn.addEventListener('click', () => {
                    this.toggleVideo();
                });
            }
            
            if (endCallBtn) {
                const newEndCallBtn = endCallBtn.cloneNode(true);
                endCallBtn.parentNode.replaceChild(newEndCallBtn, endCallBtn);
                newEndCallBtn.addEventListener('click', () => {
                    this.endCall();
                });
            }
            
            modal.classList.remove('hidden');
            this.startCallTimer();
        }
    }
    
    hideCallUI() {
        console.log('Hide call UI');
        const modal = document.getElementById('activeCallModal');
        if (modal) {
            modal.classList.add('hidden');
        }
        this.stopCallTimer();
    }
    
    // Call timer methods
    startCallTimer() {
        this.callTimer = setInterval(() => {
            if (this.callStartTime) {
                const duration = Math.floor((new Date() - this.callStartTime) / 1000);
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                const timeString = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                
                const durationElement = document.getElementById('callDuration');
                if (durationElement) {
                    durationElement.textContent = timeString;
                }
            }
        }, 1000);
    }
    
    stopCallTimer() {
        if (this.callTimer) {
            clearInterval(this.callTimer);
            this.callTimer = null;
        }
    }
    
    // User WebSocket connection for receiving call notifications
    connectUserSocket() {
        const wsScheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${wsScheme}://${window.location.host}/ws/user/`;
        
        console.log('Connecting to user WebSocket:', wsUrl);
        
        try {
            this.userSocket = new WebSocket(wsUrl);
            
            this.userSocket.onopen = (e) => {
                console.log('User WebSocket connected successfully');
            };
            
            this.userSocket.onmessage = (e) => {
                try {
                    const data = JSON.parse(e.data);
                    console.log('📨 User WebSocket message received:', data);
                    
                    // Check if this is a call message
                    if (data.type === 'incoming_call') {
                        console.log('📨 Processing incoming call message...');
                    }
                    
                    const handled = this.handleCallMessage(data);
                    console.log('📨 Message handled by WebRTC client:', handled);
                } catch (error) {
                    console.error('📨 Error parsing user WebSocket message:', error, 'Raw data:', e.data);
                }
            };
            
            this.userSocket.onclose = (e) => {
                console.log('User WebSocket closed:', e.code, e.reason);
                
                // Attempt to reconnect after 3 seconds
                if (e.code !== 1000) {
                    setTimeout(() => {
                        console.log('Attempting to reconnect user WebSocket...');
                        this.connectUserSocket();
                    }, 3000);
                }
            };
            
            this.userSocket.onerror = (e) => {
                console.error('User WebSocket error:', e);
            };
            
        } catch (error) {
            console.error('Failed to create user WebSocket:', error);
        }
    }
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebRTCClient;
}
