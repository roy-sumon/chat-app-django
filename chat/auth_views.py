from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db import IntegrityError
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from django.utils import timezone
from .models import UserProfile, Conversation, Message
import os

def login_view(request):
    if request.user.is_authenticated:
        return redirect('chat_home')
    
    # Clear any conflicting session data first
    request.session.pop('login_success', None)
    
    # Check for logout success message in session (only show once)
    if 'logout_success' in request.session and not request.session.get('message_shown'):
        messages.success(request, request.session['logout_success'], extra_tags='toast')
        del request.session['logout_success']
        request.session['message_shown'] = True
    # Only show account deletion message if there's no logout message and no message has been shown
    elif request.GET.get('deleted') == '1' and 'logout_success' not in request.session and not request.session.get('message_shown'):
        messages.success(request, 'Your account has been successfully deleted. The username is now available for new registrations.', extra_tags='toast')
        request.session['message_shown'] = True
    
    if request.method == 'POST':
        username = request.POST['username']
        password = request.POST['password']
        
        user = authenticate(request, username=username, password=password)
        if user is not None:
            login(request, user)
            # Update user status
            profile, created = UserProfile.objects.get_or_create(user=user)
            profile.is_online = True
            profile.save()
            # Clear any existing messages and store login success message
            # Clean up any previous session messages to avoid conflicts
            request.session.pop('logout_success', None)
            request.session.pop('message_shown', None)
            request.session['login_success'] = f'Welcome back, {user.get_full_name() or user.username}! You have successfully logged in.'
            return redirect('chat_home')
        else:
            messages.error(request, 'Invalid username or password. Please try again.', extra_tags='toast')
            return render(request, 'auth/login.html', {'error': True})
    
    return render(request, 'auth/login.html')

def signup_view(request):
    if request.user.is_authenticated:
        return redirect('chat_home')
    
    if request.method == 'POST':
        username = request.POST['username']
        email = request.POST['email']
        password = request.POST['password']
        password_confirm = request.POST['password_confirm']
        first_name = request.POST.get('first_name', '')
        last_name = request.POST.get('last_name', '')
        
        if password != password_confirm:
            messages.error(request, 'Passwords do not match. Please try again.', extra_tags='toast')
            return render(request, 'auth/signup.html', {
                'error': True,
                'username': username,
                'email': email,
                'first_name': first_name,
                'last_name': last_name
            })
        
        try:
            user = User.objects.create_user(
                username=username,
                email=email,
                password=password,
                first_name=first_name,
                last_name=last_name
            )
            # Create user profile
            UserProfile.objects.create(
                user=user,
                avatar=f'https://ui-avatars.com/api/?background=random&name={first_name}+{last_name}&size=128'
            )
            messages.success(request, f'Account created successfully! Welcome to ChatApp, {first_name or username}! Please log in with your credentials.', extra_tags='toast')
            return redirect('login')
        except IntegrityError:
            messages.error(request, f'Username "{username}" already exists. Please choose a different username.', extra_tags='toast')
            return render(request, 'auth/signup.html', {
                'error': True,
                'email': email,
                'first_name': first_name,
                'last_name': last_name
            })
    
    return render(request, 'auth/signup.html')

@login_required
def logout_view(request):
    username = request.user.get_full_name() or request.user.username
    
    # Update user status
    try:
        profile = UserProfile.objects.get(user=request.user)
        profile.is_online = False
        profile.save()
    except UserProfile.DoesNotExist:
        pass
    
    logout(request)
    # Clear any existing messages and store logout message
    # Clean up any previous session messages to avoid conflicts
    request.session.pop('login_success', None)
    request.session.pop('message_shown', None)
    # Clear any URL parameters that might cause conflicts
    request.session.pop('deleted_param', None)
    request.session['logout_success'] = f'Goodbye, {username}! You have been successfully logged out.'
    return redirect('login')

@login_required
@require_http_methods(["DELETE"])
def delete_account(request):
    """Permanently delete user account and all associated data"""
    try:
        user = request.user
        user_id = user.id
        
        # Delete user's profile avatar file if it exists
        try:
            profile = UserProfile.objects.get(user=user)
            if profile.avatar and hasattr(profile.avatar, 'path'):
                if os.path.isfile(profile.avatar.path):
                    os.remove(profile.avatar.path)
        except UserProfile.DoesNotExist:
            pass
        except Exception as e:
            print(f"Error deleting avatar file: {e}")
        
        # Handle conversations where this user is a participant
        user_conversations = Conversation.objects.filter(participants=user)
        for conversation in user_conversations:
            # Remove user from conversation participants
            conversation.participants.remove(user)
            
            # If conversation has no participants left, delete it entirely
            if conversation.participants.count() == 0:
                # Delete all messages and related records for empty conversations
                from .models import MessageReaction, MessageEdit, TypingStatus
                MessageReaction.objects.filter(message__conversation=conversation).delete()
                MessageEdit.objects.filter(message__conversation=conversation).delete()
                TypingStatus.objects.filter(conversation=conversation).delete()
                conversation.messages.all().delete()
                conversation.delete()
            else:
                # Mark user's messages as deleted but keep conversation for other users
                user_messages = conversation.messages.filter(sender=user)
                for message in user_messages:
                    message.is_deleted = True
                    message.deleted_by = user
                    message.deleted_at = timezone.now()
                    message.save()
        
        # Delete typing status records for this user
        from .models import TypingStatus
        TypingStatus.objects.filter(user=user).delete()
        
        # Delete user profile
        UserProfile.objects.filter(user=user).delete()
        
        # Log out the user
        logout(request)
        
        # Finally, delete the user account
        user.delete()
        
        return JsonResponse({
            'success': True,
            'message': f'Account {user_id} deleted successfully'
        })
        
    except Exception as e:
        print(f"Error deleting account: {e}")
        return JsonResponse({
            'success': False,
            'error': f'Failed to delete account: {str(e)}'
        }, status=500)
