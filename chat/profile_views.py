from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth.decorators import login_required
from django.contrib.auth.models import User
from django.contrib import messages
from django.http import JsonResponse
from django.views.decorators.http import require_http_methods
from .models import UserProfile
import json

@login_required
def profile_view(request, user_id=None):
    """View user profile"""
    if user_id:
        user = get_object_or_404(User, id=user_id)
    else:
        user = request.user
    
    profile, created = UserProfile.objects.get_or_create(user=user)
    
    context = {
        'profile_user': user,
        'profile': profile,
        'is_own_profile': user == request.user,
    }
    
    return render(request, 'chat/profile.html', context)

@login_required
def edit_profile(request):
    """Edit user profile"""
    profile, created = UserProfile.objects.get_or_create(user=request.user)
    
    if request.method == 'POST':
        # Handle form submission
        first_name = request.POST.get('first_name', '').strip()
        last_name = request.POST.get('last_name', '').strip()
        bio = request.POST.get('bio', '').strip()
        
        # Update user fields
        request.user.first_name = first_name
        request.user.last_name = last_name
        request.user.save()
        
        # Update profile fields
        profile.bio = bio
        
        # Handle avatar upload
        if 'avatar' in request.FILES:
            # Delete old avatar if exists
            if profile.avatar:
                profile.delete_avatar()
            
            profile.avatar = request.FILES['avatar']
        
        profile.save()
        
        messages.success(request, 'Profile updated successfully!', extra_tags='toast')
        return redirect('profile_view')
    
    context = {
        'profile': profile,
    }
    
    return render(request, 'chat/edit_profile.html', context)

@login_required
@require_http_methods(["POST"])
def upload_avatar(request):
    """AJAX endpoint for avatar upload"""
    try:
        if 'avatar' not in request.FILES:
            return JsonResponse({'error': 'No file uploaded'}, status=400)
        
        avatar_file = request.FILES['avatar']
        
        # Validate file type
        allowed_types = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif']
        if avatar_file.content_type not in allowed_types:
            return JsonResponse({'error': 'Invalid file type. Please upload a JPEG, PNG, or GIF image.'}, status=400)
        
        # Validate file size (5MB max)
        max_size = 5 * 1024 * 1024  # 5MB
        if avatar_file.size > max_size:
            return JsonResponse({'error': 'File too large. Please upload an image smaller than 5MB.'}, status=400)
        
        # Get or create profile
        profile, created = UserProfile.objects.get_or_create(user=request.user)
        
        # Delete old avatar if exists
        if profile.avatar:
            profile.delete_avatar()
        
        # Save new avatar
        profile.avatar = avatar_file
        profile.save()
        
        return JsonResponse({
            'success': True,
            'avatar_url': profile.get_avatar_url(),
            'message': 'Avatar uploaded successfully!'
        })
        
    except Exception as e:
        return JsonResponse({'error': f'Upload failed: {str(e)}'}, status=500)

@login_required
@require_http_methods(["POST"])
def delete_avatar(request):
    """AJAX endpoint to delete avatar"""
    try:
        profile = UserProfile.objects.get(user=request.user)
        profile.delete_avatar()
        
        return JsonResponse({
            'success': True,
            'avatar_url': profile.get_avatar_url(),
            'message': 'Avatar deleted successfully!'
        })
        
    except UserProfile.DoesNotExist:
        return JsonResponse({'error': 'Profile not found'}, status=404)
    except Exception as e:
        return JsonResponse({'error': f'Delete failed: {str(e)}'}, status=500)

@login_required
@require_http_methods(["POST"])
def update_profile_ajax(request):
    """AJAX endpoint for profile updates"""
    try:
        data = json.loads(request.body)
        
        # Update user fields
        if 'first_name' in data:
            request.user.first_name = data['first_name'].strip()
        if 'last_name' in data:
            request.user.last_name = data['last_name'].strip()
        
        request.user.save()
        
        # Update profile fields
        profile, created = UserProfile.objects.get_or_create(user=request.user)
        if 'bio' in data:
            profile.bio = data['bio'].strip()
        
        profile.save()
        
        return JsonResponse({
            'success': True,
            'message': 'Profile updated successfully!',
            'display_name': profile.display_name
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'error': 'Invalid JSON'}, status=400)
    except Exception as e:
        return JsonResponse({'error': f'Update failed: {str(e)}'}, status=500)
