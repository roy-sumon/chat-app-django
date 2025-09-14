from django.shortcuts import render, redirect
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.contrib.auth.decorators import login_required
from django.contrib import messages
from django.db import IntegrityError, transaction
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
    
    # Clear ANY existing Django messages to prevent conflicts
    storage = messages.get_messages(request)
    existing_messages = list(storage)  # Consume all messages to clear them
    if existing_messages:
        print(f"DEBUG: Login view - Cleared {len(existing_messages)} existing Django messages:")
        for msg in existing_messages:
            print(f"DEBUG: Cleared message: {msg.message} (level: {msg.level_tag})")
    
    # Check for signup success message first (highest priority)
    print(f"DEBUG: Login view - session keys: {list(request.session.keys())}")
    if 'signup_success' in request.session:
        signup_message = request.session.pop('signup_success')
        messages.success(request, signup_message, extra_tags='toast')
        print(f"DEBUG: Login view - showing signup success message: {signup_message}")
    # Check for logout success message in session (only show once)
    elif 'logout_success' in request.session and not request.session.get('message_shown'):
        messages.success(request, request.session['logout_success'], extra_tags='toast')
        del request.session['logout_success']
        request.session['message_shown'] = True
    # Only show account deletion message if there's no other message and no message has been shown
    elif request.GET.get('deleted') == '1' and 'logout_success' not in request.session and not request.session.get('message_shown'):
        messages.success(request, 'Your account has been successfully deleted. The username is now available for new registrations.', extra_tags='toast')
        request.session['message_shown'] = True
    else:
        print(f"DEBUG: Login view - No signup_success message found in session")
    
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
            request.session.pop('from_signup', None)
            request.session.pop('signup_success', None)
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
        
        print(f"DEBUG: Signup attempt - username: {username}, email: {email}, has_password: {bool(password)}, passwords_match: {password == password_confirm}")
        
        if password != password_confirm:
            print(f"DEBUG: Signup failed - passwords do not match")
            messages.error(request, 'Passwords do not match. Please try again.', extra_tags='toast')
            return render(request, 'auth/signup.html', {
                'error': True,
                'username': username,
                'email': email,
                'first_name': first_name,
                'last_name': last_name
            })
        
        # Check if username already exists before creating
        username_exists = User.objects.filter(username=username).exists()
        print(f"DEBUG: Username '{username}' exists check: {username_exists}")
        if username_exists:
            print(f"DEBUG: Signup failed - username already exists")
            messages.error(request, f'Username "{username}" already exists. Please choose a different username.', extra_tags='toast')
            return render(request, 'auth/signup.html', {
                'error': True,
                'email': email,
                'first_name': first_name,
                'last_name': last_name
            })
        
        print(f"DEBUG: Starting user creation process for username: {username}")
        try:
            with transaction.atomic():
                user = User.objects.create_user(
                    username=username,
                    email=email,
                    password=password,
                    first_name=first_name,
                    last_name=last_name
                )
                print(f"DEBUG: User {username} created successfully with ID: {user.id}")
                
                # Create user profile (use get_or_create to avoid unique constraint issues)
                profile, created = UserProfile.objects.get_or_create(
                    user=user,
                    defaults={
                        'avatar': f'https://ui-avatars.com/api/?background=random&name={first_name}+{last_name}&size=128'
                    }
                )
                if not created:
                    print(f"DEBUG: UserProfile for user {username} already existed, using existing profile")
                else:
                    print(f"DEBUG: Created new UserProfile for user {username}")
            
            # SUCCESS - User created successfully
            # Clear ALL existing Django messages to prevent conflicts
            storage = messages.get_messages(request)
            list(storage)  # Consume all messages to clear them
            
            # Clear ALL session data that might contain old messages
            request.session.pop('logout_success', None)
            request.session.pop('message_shown', None)
            request.session.pop('login_success', None)
            
            # Use session-based message instead of Django messages to avoid conflicts
            signup_msg = f'Account created successfully! Welcome to ChatApp, {first_name or username}! Please log in with your credentials.'
            request.session['signup_success'] = signup_msg
            print(f"DEBUG: Signup success - Set session message for user {username}: {signup_msg}")
            print(f"DEBUG: Signup success - Session keys after setting: {list(request.session.keys())}")
            
            return redirect('login')
            
        except Exception as e:
            # Handle any other errors during user creation
            print(f"DEBUG: Signup failed - exception occurred: {type(e).__name__}: {str(e)}")
            error_msg = f'An error occurred while creating your account: {str(e)}. Please try again.'
            messages.error(request, error_msg, extra_tags='toast')
            return render(request, 'auth/signup.html', {
                'error': True,
                'username': username,
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
    request.session.pop('from_signup', None)
    request.session.pop('signup_success', None)
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
