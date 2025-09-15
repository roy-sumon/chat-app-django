import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth.models import User
from .models import Conversation, Message, UserProfile, TypingStatus, Call
from django.utils import timezone
import asyncio
from typing import Dict, Set
import uuid

class ChatConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.conversation_id = self.scope['url_route']['kwargs']['conversation_id']
        self.room_group_name = f'chat_{self.conversation_id}'
        self.user = self.scope['user']
        
        print(f"WebSocket connection attempt - User: {self.user}, Anonymous: {self.user.is_anonymous}")
        
        if self.user.is_anonymous:
            print("WebSocket connection rejected - User is anonymous")
            await self.close(code=4001)  # Custom close code for authentication failure
            return
        
        print(f"WebSocket connection accepted - User: {self.user.username}")
        
        # Join room group
        await self.channel_layer.group_add(
            self.room_group_name,
            self.channel_name
        )
        
        # Join user's personal group for call notifications
        await self.channel_layer.group_add(
            f'user_{self.user.id}',
            self.channel_name
        )
        
        await self.accept()
        
        # Mark user as online
        await self.update_user_status(True)
        
        # Send user joined notification to room
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                'type': 'user_status',
                'user_id': self.user.id,
                'username': self.user.username,
                'is_online': True
            }
        )

    async def disconnect(self, close_code):
        if hasattr(self, 'user') and not self.user.is_anonymous:
            # Mark user as offline
            await self.update_user_status(False)
            
            # Stop typing if user was typing
            await self.set_typing_status(False)
            
            # Send user left notification to room
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    'type': 'user_status',
                    'user_id': self.user.id,
                    'username': self.user.username,
                    'is_online': False
                }
            )
        
        # Leave room group
        if hasattr(self, 'room_group_name'):
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )
        
        # Leave user's personal group
        if hasattr(self, 'user') and not self.user.is_anonymous:
            await self.channel_layer.group_discard(
                f'user_{self.user.id}',
                self.channel_name
            )

    async def receive(self, text_data):
        try:
            text_data_json = json.loads(text_data)
            message_type = text_data_json.get('type', 'message')
            
            if message_type == 'message':
                message_content = text_data_json.get('message', '')
                temp_id = text_data_json.get('temp_id', None)
                
                if not message_content.strip():
                    return
                
                # Save message to database
                message = await self.save_message(message_content)
                
                # Send message to room group
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'chat_message',
                        'message': message_content,
                        'username': self.user.username,
                        'user_id': self.user.id,
                        'timestamp': message['timestamp'],
                        'message_id': message['id'],
                        'status': 'sent',
                        'temp_id': temp_id
                    }
                )
            
            elif message_type == 'typing':
                is_typing = text_data_json.get('is_typing', False)
                await self.set_typing_status(is_typing)
                
                # Send typing status to room group
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'typing_status',
                        'user_id': self.user.id,
                        'username': self.user.username,
                        'is_typing': is_typing
                    }
                )
            
            elif message_type == 'message_read':
                message_id = text_data_json.get('message_id')
                await self.mark_message_read(message_id)
                
                # Send read status to room group
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'message_status_update',
                        'message_id': message_id,
                        'status': 'read'
                    }
                )
            
            elif message_type == 'message_reaction':
                message_id = text_data_json.get('message_id')
                emoji = text_data_json.get('emoji')
                action = text_data_json.get('action', 'add')  # 'add' or 'remove'
                
                if message_id and emoji:
                    result = await self.handle_message_reaction(message_id, emoji, action)
                    if result:
                        # Send reaction update to room group
                        await self.channel_layer.group_send(
                            self.room_group_name,
                            {
                                'type': 'reaction_update',
                                'message_id': message_id,
                                'emoji': emoji,
                                'user_id': self.user.id,
                                'username': self.user.username,
                                'action': action,
                                'reactions': result
                            }
                        )
            
            elif message_type == 'message_edit':
                message_id = text_data_json.get('message_id')
                new_content = text_data_json.get('content', '').strip()
                
                if message_id and new_content:
                    result = await self.edit_message(message_id, new_content)
                    if result:
                        # Send edit update to room group
                        await self.channel_layer.group_send(
                            self.room_group_name,
                            {
                                'type': 'message_edit_update',
                                'message_id': message_id,
                                'new_content': new_content,
                                'edited_by': self.user.username,
                                'edited_at': result['edited_at']
                            }
                        )
            
            elif message_type == 'message_delete':
                message_id = text_data_json.get('message_id')
                
                if message_id:
                    result = await self.delete_message(message_id)
                    if result:
                        # Send delete update to room group
                        await self.channel_layer.group_send(
                            self.room_group_name,
                            {
                                'type': 'message_delete_update',
                                'message_id': message_id,
                                'deleted_by': self.user.username
                            }
                        )
            
            elif message_type == 'file_message':
                # Handle file message notification (after file upload via HTTP)
                message_id = text_data_json.get('message_id')
                if message_id:
                    message_data = await self.get_file_message(message_id)
                    if message_data:
                        # Send file message to room group
                        await self.channel_layer.group_send(
                            self.room_group_name,
                            {
                                'type': 'file_message_update',
                                'message_id': message_data['id'],
                                'content': message_data['content'],
                                'file_url': message_data['file_url'],
                                'file_name': message_data['file_name'],
                                'file_size': message_data['file_size'],
                                'file_icon': message_data['file_icon'],
                                'message_type': message_data['message_type'],
                                'is_image': message_data['is_image'],
                                'username': self.user.username,
                                'user_id': self.user.id,
                                'timestamp': message_data['timestamp'],
                                'status': 'sent'
                            }
                        )
                        
            elif message_type == 'user_activity':
                activity = text_data_json.get('activity', 'active')  # 'active', 'away', 'busy'
                await self.update_user_activity(activity)
                
                # Send activity status to room group
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'user_activity_update',
                        'user_id': self.user.id,
                        'username': self.user.username,
                        'activity': activity
                    }
                )
            
            # Call signaling message types
            elif message_type == 'call_initiate':
                call_type = text_data_json.get('call_type', 'audio')  # 'audio' or 'video'
                callee_id = text_data_json.get('callee_id')
                
                print(f"📞 Call initiation: {self.user.username} -> User {callee_id}, Type: {call_type}")
                
                if callee_id:
                    call = await self.initiate_call(callee_id, call_type)
                    print(f"📞 Call created: {call}")
                    
                    if call:
                        group_name = f'user_{callee_id}'
                        print(f"📞 Sending call notification to group: {group_name}")
                        
                        # Send call initiation to the callee
                        await self.channel_layer.group_send(
                            group_name,
                            {
                                'type': 'incoming_call',
                                'call_id': str(call['call_id']),
                                'caller_id': self.user.id,
                                'caller_name': self.user.username,
                                'call_type': call_type,
                                'conversation_id': self.conversation_id
                            }
                        )
                        print(f"📞 Call notification sent to {group_name}")
                    else:
                        print(f"📞 Failed to create call - call is None")
                else:
                    print(f"📞 No callee_id provided")
            
            elif message_type == 'call_accept':
                call_id = text_data_json.get('call_id')
                if call_id:
                    success = await self.accept_call(call_id)
                    if success:
                        call_data = await self.get_call_data(call_id)
                        # Notify caller that call was accepted
                        await self.channel_layer.group_send(
                            f'user_{call_data["caller_id"]}',
                            {
                                'type': 'call_accepted',
                                'call_id': call_id,
                                'accepter_id': self.user.id
                            }
                        )
            
            elif message_type == 'call_reject':
                call_id = text_data_json.get('call_id')
                if call_id:
                    success = await self.reject_call(call_id)
                    if success:
                        call_data = await self.get_call_data(call_id)
                        # Notify caller that call was rejected
                        await self.channel_layer.group_send(
                            f'user_{call_data["caller_id"]}',
                            {
                                'type': 'call_rejected',
                                'call_id': call_id,
                                'rejecter_id': self.user.id
                            }
                        )
            
            elif message_type == 'call_end':
                call_id = text_data_json.get('call_id')
                if call_id:
                    success = await self.end_call(call_id)
                    if success:
                        call_data = await self.get_call_data(call_id)
                        other_user_id = call_data['caller_id'] if call_data['caller_id'] != self.user.id else call_data['callee_id']
                        # Notify other participant that call ended
                        await self.channel_layer.group_send(
                            f'user_{other_user_id}',
                            {
                                'type': 'call_ended',
                                'call_id': call_id,
                                'ended_by': self.user.id
                            }
                        )
            
            # WebRTC signaling
            elif message_type == 'webrtc_offer':
                call_id = text_data_json.get('call_id')
                offer = text_data_json.get('offer')
                if call_id and offer:
                    call_data = await self.get_call_data(call_id)
                    other_user_id = call_data['callee_id']
                    await self.channel_layer.group_send(
                        f'user_{other_user_id}',
                        {
                            'type': 'webrtc_offer_received',
                            'call_id': call_id,
                            'offer': offer,
                            'from_user_id': self.user.id
                        }
                    )
            
            elif message_type == 'webrtc_answer':
                call_id = text_data_json.get('call_id')
                answer = text_data_json.get('answer')
                if call_id and answer:
                    call_data = await self.get_call_data(call_id)
                    other_user_id = call_data['caller_id']
                    await self.channel_layer.group_send(
                        f'user_{other_user_id}',
                        {
                            'type': 'webrtc_answer_received',
                            'call_id': call_id,
                            'answer': answer,
                            'from_user_id': self.user.id
                        }
                    )
            
            elif message_type == 'webrtc_ice_candidate':
                call_id = text_data_json.get('call_id')
                candidate = text_data_json.get('candidate')
                if call_id and candidate:
                    call_data = await self.get_call_data(call_id)
                    other_user_id = call_data['caller_id'] if call_data['caller_id'] != self.user.id else call_data['callee_id']
                    await self.channel_layer.group_send(
                        f'user_{other_user_id}',
                        {
                            'type': 'webrtc_ice_candidate_received',
                            'call_id': call_id,
                            'candidate': candidate,
                            'from_user_id': self.user.id
                        }
                    )
                
        except Exception as e:
            print(f"Error in receive: {e}")

    async def chat_message(self, event):
        # Send message to WebSocket
        message_data = {
            'type': 'message',
            'message': event['message'],
            'username': event['username'],
            'user_id': event['user_id'],
            'timestamp': event['timestamp'],
            'message_id': event['message_id'],
            'status': event['status']
        }
        
        # Include temp_id if present
        if 'temp_id' in event and event['temp_id']:
            message_data['temp_id'] = event['temp_id']
        
        await self.send(text_data=json.dumps(message_data))

    async def typing_status(self, event):
        # Don't send typing status to the user who is typing
        if event['user_id'] != self.user.id:
            await self.send(text_data=json.dumps({
                'type': 'typing',
                'user_id': event['user_id'],
                'username': event['username'],
                'is_typing': event['is_typing']
            }))

    async def user_status(self, event):
        # Send user status update to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'user_status',
            'user_id': event['user_id'],
            'username': event['username'],
            'is_online': event['is_online']
        }))

    async def message_status_update(self, event):
        # Send message status update to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'message_status',
            'message_id': event['message_id'],
            'status': event['status']
        }))
    
    async def reaction_update(self, event):
        # Send reaction update to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'reaction',
            'message_id': event['message_id'],
            'emoji': event['emoji'],
            'user_id': event['user_id'],
            'username': event['username'],
            'action': event['action'],
            'reactions': event['reactions']
        }))
    
    async def message_edit_update(self, event):
        # Send message edit update to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'message_edit',
            'message_id': event['message_id'],
            'new_content': event['new_content'],
            'edited_by': event['edited_by'],
            'edited_at': event['edited_at']
        }))
    
    async def message_delete_update(self, event):
        # Send message delete update to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'message_delete',
            'message_id': event['message_id'],
            'deleted_by': event['deleted_by']
        }))
    
    async def file_message_update(self, event):
        # Send file message to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'file_message',
            'message_id': event['message_id'],
            'content': event['content'],
            'file_url': event['file_url'],
            'file_name': event['file_name'],
            'file_size': event['file_size'],
            'file_icon': event['file_icon'],
            'message_type': event['message_type'],
            'is_image': event['is_image'],
            'username': event['username'],
            'user_id': event['user_id'],
            'timestamp': event['timestamp'],
            'status': event['status']
        }))
    
    async def user_activity_update(self, event):
        # Send user activity update to WebSocket
        if event['user_id'] != self.user.id:  # Don't send to the user who changed activity
            await self.send(text_data=json.dumps({
                'type': 'user_activity',
                'user_id': event['user_id'],
                'username': event['username'],
                'activity': event['activity']
            }))
    
    # Call event handlers
    async def incoming_call(self, event):
        """Handle incoming call notification"""
        print(f"📨 Incoming call handler triggered for user {self.user.username}")
        print(f"📨 Event data: {event}")
        
        call_data = {
            'type': 'incoming_call',
            'call_id': event['call_id'],
            'caller_id': event['caller_id'],
            'caller_name': event['caller_name'],
            'call_type': event['call_type'],
            'conversation_id': event.get('conversation_id')
        }
        
        print(f"📨 Sending call data to WebSocket: {call_data}")
        
        await self.send(text_data=json.dumps(call_data))
        
        print(f"📨 Call notification sent to WebSocket for user {self.user.username}")
    
    async def call_accepted(self, event):
        # Send call accepted notification to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'call_accepted',
            'call_id': event['call_id'],
            'accepter_id': event['accepter_id']
        }))
    
    async def call_rejected(self, event):
        # Send call rejected notification to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'call_rejected',
            'call_id': event['call_id'],
            'rejecter_id': event['rejecter_id']
        }))
    
    async def call_ended(self, event):
        # Send call ended notification to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'call_ended',
            'call_id': event['call_id'],
            'ended_by': event['ended_by']
        }))
    
    # WebRTC signaling handlers
    async def webrtc_offer_received(self, event):
        # Send WebRTC offer to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'webrtc_offer',
            'call_id': event['call_id'],
            'offer': event['offer'],
            'from_user_id': event['from_user_id']
        }))
    
    async def webrtc_answer_received(self, event):
        # Send WebRTC answer to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'webrtc_answer',
            'call_id': event['call_id'],
            'answer': event['answer'],
            'from_user_id': event['from_user_id']
        }))
    
    async def webrtc_ice_candidate_received(self, event):
        # Send WebRTC ICE candidate to WebSocket
        await self.send(text_data=json.dumps({
            'type': 'webrtc_ice_candidate',
            'call_id': event['call_id'],
            'candidate': event['candidate'],
            'from_user_id': event['from_user_id']
        }))

    @database_sync_to_async
    def save_message(self, content):
        conversation = Conversation.objects.get(id=self.conversation_id)
        message = Message.objects.create(
            conversation=conversation,
            sender=self.user,
            content=content
        )
        conversation.updated_at = timezone.now()
        conversation.save()
        
        return {
            'id': message.id,
            'timestamp': message.timestamp.isoformat()
        }

    @database_sync_to_async
    def update_user_status(self, is_online):
        try:
            profile = UserProfile.objects.get(user=self.user)
            profile.is_online = is_online
            if not is_online:
                profile.last_seen = timezone.now()
            profile.save()
        except UserProfile.DoesNotExist:
            UserProfile.objects.create(
                user=self.user,
                is_online=is_online,
                last_seen=timezone.now()
            )

    @database_sync_to_async
    def set_typing_status(self, is_typing):
        try:
            conversation = Conversation.objects.get(id=self.conversation_id)
            typing_status, created = TypingStatus.objects.get_or_create(
                conversation=conversation,
                user=self.user
            )
            typing_status.is_typing = is_typing
            typing_status.save()
        except Conversation.DoesNotExist:
            pass

    @database_sync_to_async
    def mark_message_read(self, message_id):
        try:
            message = Message.objects.get(id=message_id)
            message.mark_as_read()
        except Message.DoesNotExist:
            pass
    
    @database_sync_to_async
    def handle_message_reaction(self, message_id, emoji, action):
        try:
            from .models import MessageReaction
            message = Message.objects.get(id=message_id)
            
            if action == 'add':
                reaction, created = MessageReaction.objects.get_or_create(
                    message=message,
                    user=self.user,
                    emoji=emoji
                )
            elif action == 'remove':
                MessageReaction.objects.filter(
                    message=message,
                    user=self.user,
                    emoji=emoji
                ).delete()
            
            # Get all reactions for this message
            reactions = {}
            for reaction in MessageReaction.objects.filter(message=message).select_related('user'):
                if reaction.emoji not in reactions:
                    reactions[reaction.emoji] = []
                reactions[reaction.emoji].append({
                    'user_id': reaction.user.id,
                    'username': reaction.user.username
                })
            
            return reactions
        except Message.DoesNotExist:
            return None
    
    @database_sync_to_async
    def edit_message(self, message_id, new_content):
        try:
            from .models import MessageEdit
            message = Message.objects.get(id=message_id, sender=self.user)
            
            # Create edit record
            MessageEdit.objects.create(
                message=message,
                old_content=message.content,
                new_content=new_content,
                edited_by=self.user
            )
            
            # Update message
            message.content = new_content
            message.is_edited = True
            message.edited_at = timezone.now()
            message.save()
            
            return {
                'success': True,
                'edited_at': message.edited_at.isoformat()
            }
        except Message.DoesNotExist:
            return None
    
    @database_sync_to_async
    def delete_message(self, message_id):
        try:
            message = Message.objects.get(id=message_id, sender=self.user)
            message.soft_delete(self.user)
            return {'success': True}
        except Message.DoesNotExist:
            return None
    
    @database_sync_to_async
    def get_file_message(self, message_id):
        try:
            message = Message.objects.get(id=message_id)
            return {
                'id': message.id,
                'content': message.content,
                'file_url': message.file.url if message.file else None,
                'file_name': message.file_name,
                'file_size': message.format_file_size(),
                'file_icon': message.get_file_icon(),
                'message_type': message.message_type,
                'is_image': message.is_image,
                'timestamp': message.timestamp.isoformat()
            }
        except Message.DoesNotExist:
            return None
    
    @database_sync_to_async
    def update_user_activity(self, activity):
        try:
            profile = UserProfile.objects.get(user=self.user)
            # You could add an activity field to UserProfile if needed
            # For now, we'll just update last_seen
            profile.last_seen = timezone.now()
            profile.save()
        except UserProfile.DoesNotExist:
            UserProfile.objects.create(
                user=self.user,
                last_seen=timezone.now()
            )
    
    # Call management database methods
    @database_sync_to_async
    def initiate_call(self, callee_id, call_type):
        try:
            conversation = Conversation.objects.get(id=self.conversation_id)
            callee = User.objects.get(id=callee_id)
            
            # Check if there's already an active call
            active_call = Call.objects.filter(
                conversation=conversation,
                status__in=['initiated', 'ringing', 'accepted']
            ).first()
            
            if active_call:
                return None  # Call already in progress
            
            call = Call.objects.create(
                conversation=conversation,
                caller=self.user,
                callee=callee,
                call_type=call_type,
                status='initiated'
            )
            
            return {
                'call_id': call.call_id,
                'caller_id': self.user.id,
                'callee_id': callee_id,
                'call_type': call_type
            }
        except (Conversation.DoesNotExist, User.DoesNotExist):
            return None
    
    @database_sync_to_async
    def accept_call(self, call_id):
        try:
            call = Call.objects.get(call_id=call_id, callee=self.user)
            call.accept_call()
            return True
        except Call.DoesNotExist:
            return False
    
    @database_sync_to_async
    def reject_call(self, call_id):
        try:
            call = Call.objects.get(call_id=call_id, callee=self.user)
            call.reject_call()
            return True
        except Call.DoesNotExist:
            return False
    
    @database_sync_to_async
    def end_call(self, call_id):
        try:
            call = Call.objects.get(call_id=call_id)
            # Check if user is participant in this call
            if call.caller == self.user or call.callee == self.user:
                call.end_call()
                return True
            return False
        except Call.DoesNotExist:
            return False
    
    @database_sync_to_async
    def get_call_data(self, call_id):
        try:
            call = Call.objects.get(call_id=call_id)
            return {
                'call_id': str(call.call_id),
                'caller_id': call.caller.id,
                'callee_id': call.callee.id,
                'call_type': call.call_type,
                'status': call.status,
                'conversation_id': call.conversation.id
            }
        except Call.DoesNotExist:
            return None


class UserConsumer(AsyncWebsocketConsumer):
    """Consumer for user-specific notifications like incoming calls"""
    
    async def connect(self):
        self.user = self.scope['user']
        
        if self.user.is_anonymous:
            await self.close(code=4001)
            return
        
        # Join user's personal group
        self.user_group_name = f'user_{self.user.id}'
        await self.channel_layer.group_add(
            self.user_group_name,
            self.channel_name
        )
        
        await self.accept()
        print(f"User {self.user.username} connected to personal channel")
    
    async def disconnect(self, close_code):
        if hasattr(self, 'user_group_name'):
            await self.channel_layer.group_discard(
                self.user_group_name,
                self.channel_name
            )
        print(f"User {self.user.username if hasattr(self, 'user') else 'unknown'} disconnected from personal channel")
    
    async def receive(self, text_data):
        # Handle any user-specific messages if needed
        pass
    
    # Call event handlers - these are the same as in ChatConsumer
    async def incoming_call(self, event):
        await self.send(text_data=json.dumps({
            'type': 'incoming_call',
            'call_id': event['call_id'],
            'caller_id': event['caller_id'],
            'caller_name': event['caller_name'],
            'call_type': event['call_type'],
            'conversation_id': event['conversation_id']
        }))
    
    async def call_accepted(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_accepted',
            'call_id': event['call_id'],
            'accepter_id': event['accepter_id']
        }))
    
    async def call_rejected(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_rejected',
            'call_id': event['call_id'],
            'rejecter_id': event['rejecter_id']
        }))
    
    async def call_ended(self, event):
        await self.send(text_data=json.dumps({
            'type': 'call_ended',
            'call_id': event['call_id'],
            'ended_by': event['ended_by']
        }))
    
    # WebRTC signaling handlers
    async def webrtc_offer_received(self, event):
        await self.send(text_data=json.dumps({
            'type': 'webrtc_offer',
            'call_id': event['call_id'],
            'offer': event['offer'],
            'from_user_id': event['from_user_id']
        }))
    
    async def webrtc_answer_received(self, event):
        await self.send(text_data=json.dumps({
            'type': 'webrtc_answer',
            'call_id': event['call_id'],
            'answer': event['answer'],
            'from_user_id': event['from_user_id']
        }))
    
    async def webrtc_ice_candidate_received(self, event):
        await self.send(text_data=json.dumps({
            'type': 'webrtc_ice_candidate',
            'call_id': event['call_id'],
            'candidate': event['candidate'],
            'from_user_id': event['from_user_id']
        }))
