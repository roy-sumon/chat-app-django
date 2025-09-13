from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.contrib.auth.models import User
from django.db.models import Q
from .models import Conversation, Message, UserProfile
from django.views.decorators.http import require_http_methods
from django.core.paginator import Paginator
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
import json

@login_required
def chat_home(request):
    """Main chat interface showing conversations and messages"""
    # Check for login success message in session
    from django.contrib import messages
    # Clear any logout messages that might conflict
    if 'logout_success' in request.session:
        del request.session['logout_success']
    
    if 'login_success' in request.session and not request.session.get('message_shown'):
        messages.success(request, request.session['login_success'], extra_tags='toast')
        del request.session['login_success']
        request.session['message_shown'] = True
    
    # Ensure user has a profile
    user_profile, created = UserProfile.objects.get_or_create(user=request.user)
    
    # Get user's conversations (hard deleted conversations are completely removed from DB)
    conversations = Conversation.objects.filter(
        participants=request.user
    ).prefetch_related('participants', 'messages')
    
    # Add other_user to each conversation for template use
    conversation_list = []
    for conv in conversations:
        other_user = conv.participants.exclude(id=request.user.id).first()
        conversation_list.append({
            'conversation': conv,
            'other_user': other_user
        })
    
    # Get all users for starting new conversations
    users = User.objects.exclude(id=request.user.id).select_related('userprofile')
    
    # Get selected conversation if any
    selected_conversation = None
    selected_other_user = None
    messages = []
    
    conversation_id = request.GET.get('conversation')
    if conversation_id:
        try:
            # Get conversation (hard deleted conversations won't exist in DB)
            selected_conversation = Conversation.objects.get(
                id=conversation_id,
                participants=request.user
            )
            selected_other_user = selected_conversation.participants.exclude(id=request.user.id).first()
            messages = selected_conversation.messages.all().select_related('sender', 'deleted_by').order_by('timestamp')
            
            # Mark messages as read
            unread_messages = messages.exclude(sender=request.user).filter(
                Q(status='sent') | Q(status='delivered')
            )
            for message in unread_messages:
                message.mark_as_read()
                
        except Conversation.DoesNotExist:
            pass
    
    context = {
        'conversation_list': conversation_list,
        'selected_conversation': selected_conversation,
        'selected_other_user': selected_other_user,
        'messages': messages,
        'users': users,
    }
    return render(request, 'chat/chat_home.html', context)

@login_required
@require_http_methods(["POST"])
def start_conversation(request):
    """Start a new conversation with a user"""
    data = json.loads(request.body)
    user_id = data.get('user_id')
    
    try:
        other_user = User.objects.get(id=user_id)
        
        # Check if conversation already exists
        existing_conversation = Conversation.objects.filter(
            participants=request.user
        ).filter(
            participants=other_user
        ).first()
        
        if existing_conversation:
            conversation_id = existing_conversation.id
        else:
            # Create new conversation - this will always create a fresh conversation
            # if the previous one was deleted (hard deleted)
            conversation = Conversation.objects.create()
            conversation.participants.add(request.user, other_user)
            conversation_id = conversation.id
        
        return JsonResponse({
            'success': True,
            'conversation_id': conversation_id,
            'redirect_url': f'/?conversation={conversation_id}'
        })
        
    except User.DoesNotExist:
        return JsonResponse({'success': False, 'error': 'Invalid request'})

@login_required
def debug_chat(request):
    """Debug page for troubleshooting chat issues"""
    return render(request, 'debug_chat.html')

@require_http_methods(["GET"])
def debug_db_check(request):
    """API endpoint to check database state"""
    try:
        # Get basic stats
        stats = {
            'total_users': User.objects.count(),
            'total_conversations': Conversation.objects.count(),
            'total_messages': Message.objects.count(),
            'current_user': {
                'id': request.user.id if request.user.is_authenticated else None,
                'username': request.user.username if request.user.is_authenticated else 'Anonymous',
                'is_authenticated': request.user.is_authenticated
            }
        }
        
        # Get recent messages
        recent_messages = []
        for msg in Message.objects.select_related('sender', 'conversation').order_by('-timestamp')[:5]:
            recent_messages.append({
                'id': msg.id,
                'content': msg.content[:50] + '...' if len(msg.content) > 50 else msg.content,
                'sender': msg.sender.username,
                'conversation_id': msg.conversation.id,
                'timestamp': msg.timestamp.isoformat(),
                'status': msg.status
            })
        
        # Get conversations
        conversations = []
        for conv in Conversation.objects.prefetch_related('participants').all():
            conversations.append({
                'id': conv.id,
                'participants': [p.username for p in conv.participants.all()],
                'created_at': conv.created_at.isoformat(),
                'message_count': conv.messages.count()
            })
        
        return JsonResponse({
            'stats': stats,
            'recent_messages': recent_messages,
            'conversations': conversations
        })
    except Exception as e:
        return JsonResponse({
            'error': str(e),
            'type': type(e).__name__
        }, status=500)

@login_required
def get_messages(request, conversation_id):
    """Get messages for a specific conversation (AJAX endpoint)"""
    try:
        conversation = Conversation.objects.get(
            id=conversation_id,
            participants=request.user
        )
        
        page = request.GET.get('page', 1)
        messages = conversation.messages.all().select_related('sender').order_by('-timestamp')
        
        paginator = Paginator(messages, 50)
        page_obj = paginator.get_page(page)
        
        messages_data = []
        for message in reversed(page_obj.object_list):
            messages_data.append({
                'id': message.id,
                'content': message.content,
                'sender_id': message.sender.id,
                'sender_username': message.sender.username,
                'timestamp': message.timestamp.isoformat(),
                'status': message.status,
                'is_own': message.sender == request.user
            })
        
        return JsonResponse({
            'messages': messages_data,
            'has_next': page_obj.has_next(),
            'has_previous': page_obj.has_previous(),
            'page_number': page_obj.number,
            'total_pages': paginator.num_pages
        })
        
    except Conversation.DoesNotExist:
        return JsonResponse({'error': 'Conversation not found'}, status=404)

@login_required
def user_search(request):
    """Search for users to start conversations with"""
    query = request.GET.get('q', '')
    
    if len(query) < 2:
        return JsonResponse({'users': []})
    
    users = User.objects.filter(
        Q(username__icontains=query) |
        Q(first_name__icontains=query) |
        Q(last_name__icontains=query)
    ).exclude(id=request.user.id).select_related('userprofile')[:10]
    
    users_data = []
    for user in users:
        try:
            profile = user.userprofile
        except UserProfile.DoesNotExist:
            profile = UserProfile.objects.create(user=user)
        
        users_data.append({
            'id': user.id,
            'username': user.username,
            'display_name': profile.display_name,
            'avatar': profile.get_avatar_url(),
            'is_online': profile.is_online
        })
    
    return JsonResponse({'users': users_data})

@login_required
@require_http_methods(["DELETE"])
def delete_message(request, message_id):
    """Delete a specific message"""
    try:
        message = Message.objects.get(id=message_id)
        
        # Only the sender can delete their own messages
        if message.sender != request.user:
            return JsonResponse({'error': 'You can only delete your own messages'}, status=403)
        
        # Soft delete the message
        message.soft_delete(request.user)
        
        return JsonResponse({
            'success': True,
            'message': 'Message deleted successfully'
        })
        
    except Message.DoesNotExist:
        return JsonResponse({'error': 'Message not found'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@login_required
@require_http_methods(["DELETE"])
def delete_conversation(request, conversation_id):
    """Permanently delete a conversation and all its messages"""
    try:
        conversation = Conversation.objects.get(
            id=conversation_id,
            participants=request.user
        )
        
        # Hard delete: Remove all messages in the conversation
        conversation.messages.all().delete()
        
        # Delete any related records (reactions, edits, typing status, etc.)
        from .models import MessageReaction, MessageEdit, TypingStatus, ConversationDeletion
        MessageReaction.objects.filter(message__conversation=conversation).delete()
        MessageEdit.objects.filter(message__conversation=conversation).delete()
        TypingStatus.objects.filter(conversation=conversation).delete()
        
        # Delete conversation deletion records if they exist
        ConversationDeletion.objects.filter(conversation=conversation).delete()
        
        # Finally, delete the conversation itself
        conversation.delete()
        
        return JsonResponse({
            'success': True,
            'message': 'Conversation and all messages deleted permanently'
        })
        
    except Conversation.DoesNotExist:
        return JsonResponse({'error': 'Conversation not found'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@login_required
@require_http_methods(["POST"])
def restore_message(request, message_id):
    """Restore a deleted message"""
    try:
        message = Message.objects.get(id=message_id)
        
        # Only the sender can restore their own messages
        if message.sender != request.user:
            return JsonResponse({'error': 'You can only restore your own messages'}, status=403)
        
        # Check if message is actually deleted
        if not message.is_deleted:
            return JsonResponse({'error': 'Message is not deleted'}, status=400)
        
        # Restore the message
        message.restore()
        
        return JsonResponse({
            'success': True,
            'message': 'Message restored successfully'
        })
        
    except Message.DoesNotExist:
        return JsonResponse({'error': 'Message not found'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

@login_required
@require_http_methods(["PUT", "PATCH"])
def edit_message(request, message_id):
    """Edit a message"""
    try:
        message = Message.objects.get(id=message_id)
        
        # Only the sender can edit their own messages
        if message.sender != request.user:
            return JsonResponse({'error': 'You can only edit your own messages'}, status=403)
        
        # Check if message is deleted
        if message.is_deleted:
            return JsonResponse({'error': 'Cannot edit a deleted message'}, status=400)
        
        # Get new content from request
        import json
        try:
            data = json.loads(request.body)
            new_content = data.get('content', '').strip()
        except json.JSONDecodeError:
            return JsonResponse({'error': 'Invalid JSON'}, status=400)
        
        if not new_content:
            return JsonResponse({'error': 'Content cannot be empty'}, status=400)
        
        # Create edit record
        from .models import MessageEdit
        MessageEdit.objects.create(
            message=message,
            old_content=message.content,
            new_content=new_content,
            edited_by=request.user
        )
        
        # Update message
        message.content = new_content
        message.is_edited = True
        message.edited_at = timezone.now()
        message.save()
        
        return JsonResponse({
            'success': True,
            'message': 'Message edited successfully',
            'new_content': new_content,
            'edited_at': message.edited_at.isoformat()
        })
        
    except Message.DoesNotExist:
        return JsonResponse({'error': 'Message not found'}, status=404)
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)
