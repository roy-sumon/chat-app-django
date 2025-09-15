from django.shortcuts import render, get_object_or_404, redirect
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, Http404
from django.views.decorators.http import require_POST, require_http_methods
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.models import User
from django.db.models import Q
from django.utils import timezone
import json

from .models import Call, Conversation, UserProfile

@login_required
@require_POST
def initiate_call(request):
    """Initiate a new audio or video call"""
    try:
        data = json.loads(request.body)
        call_type = data.get('call_type', 'audio')  # 'audio' or 'video'
        conversation_id = data.get('conversation_id')
        callee_id = data.get('callee_id')
        
        if not all([conversation_id, callee_id]):
            return JsonResponse({'success': False, 'error': 'Missing required parameters'})
        
        # Validate call type
        if call_type not in ['audio', 'video']:
            return JsonResponse({'success': False, 'error': 'Invalid call type'})
        
        # Get conversation and verify user is participant
        conversation = get_object_or_404(Conversation, id=conversation_id)
        if request.user not in conversation.participants.all():
            return JsonResponse({'success': False, 'error': 'Not authorized to access this conversation'})
        
        # Get callee and verify they're in the conversation
        callee = get_object_or_404(User, id=callee_id)
        if callee not in conversation.participants.all():
            return JsonResponse({'success': False, 'error': 'Callee is not in this conversation'})
        
        # Check if there's already an active call
        active_call = Call.objects.filter(
            conversation=conversation,
            status__in=['initiated', 'ringing', 'accepted']
        ).first()
        
        if active_call:
            return JsonResponse({'success': False, 'error': 'Call already in progress'})
        
        # Create new call
        call = Call.objects.create(
            conversation=conversation,
            caller=request.user,
            callee=callee,
            call_type=call_type,
            status='initiated'
        )
        
        return JsonResponse({
            'success': True,
            'call_id': str(call.call_id),
            'call_type': call_type,
            'caller_id': request.user.id,
            'callee_id': callee.id,
            'conversation_id': conversation.id
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})

@login_required
@require_POST
def accept_call(request):
    """Accept an incoming call"""
    try:
        data = json.loads(request.body)
        call_id = data.get('call_id')
        
        if not call_id:
            return JsonResponse({'success': False, 'error': 'Call ID required'})
        
        # Get call and verify user is the callee
        call = get_object_or_404(Call, call_id=call_id, callee=request.user)
        
        # Check if call can be accepted
        if call.status not in ['initiated', 'ringing']:
            return JsonResponse({'success': False, 'error': 'Call cannot be accepted'})
        
        # Accept the call
        call.accept_call()
        
        return JsonResponse({
            'success': True,
            'call_id': str(call.call_id),
            'status': call.status,
            'accepted_at': call.accepted_at.isoformat() if call.accepted_at else None
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})

@login_required
@require_POST
def reject_call(request):
    """Reject an incoming call"""
    try:
        data = json.loads(request.body)
        call_id = data.get('call_id')
        
        if not call_id:
            return JsonResponse({'success': False, 'error': 'Call ID required'})
        
        # Get call and verify user is the callee
        call = get_object_or_404(Call, call_id=call_id, callee=request.user)
        
        # Check if call can be rejected
        if call.status not in ['initiated', 'ringing']:
            return JsonResponse({'success': False, 'error': 'Call cannot be rejected'})
        
        # Reject the call
        call.reject_call()
        
        return JsonResponse({
            'success': True,
            'call_id': str(call.call_id),
            'status': call.status
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})

@login_required
@require_POST
def end_call(request):
    """End an active call"""
    try:
        data = json.loads(request.body)
        call_id = data.get('call_id')
        
        if not call_id:
            return JsonResponse({'success': False, 'error': 'Call ID required'})
        
        # Get call and verify user is a participant
        call = get_object_or_404(Call, call_id=call_id)
        
        if call.caller != request.user and call.callee != request.user:
            return JsonResponse({'success': False, 'error': 'Not authorized to end this call'})
        
        # End the call
        call.end_call()
        
        return JsonResponse({
            'success': True,
            'call_id': str(call.call_id),
            'status': call.status,
            'duration': call.formatted_duration
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})

@login_required
def get_call_status(request, call_id):
    """Get current status of a call"""
    try:
        call = get_object_or_404(Call, call_id=call_id)
        
        # Verify user is a participant
        if call.caller != request.user and call.callee != request.user:
            return JsonResponse({'success': False, 'error': 'Not authorized to view this call'})
        
        return JsonResponse({
            'success': True,
            'call_id': str(call.call_id),
            'status': call.status,
            'call_type': call.call_type,
            'caller_id': call.caller.id,
            'caller_name': call.caller.username,
            'callee_id': call.callee.id,
            'callee_name': call.callee.username,
            'initiated_at': call.initiated_at.isoformat(),
            'accepted_at': call.accepted_at.isoformat() if call.accepted_at else None,
            'ended_at': call.ended_at.isoformat() if call.ended_at else None,
            'duration': call.formatted_duration if call.duration else None
        })
        
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})

@login_required
def call_history(request):
    """Get call history for the user"""
    try:
        # Get all calls where user is either caller or callee
        calls = Call.objects.filter(
            Q(caller=request.user) | Q(callee=request.user)
        ).select_related('caller', 'callee', 'conversation').order_by('-initiated_at')
        
        # Limit to recent calls
        limit = int(request.GET.get('limit', 50))
        calls = calls[:limit]
        
        call_list = []
        for call in calls:
            # Determine the other participant
            other_user = call.callee if call.caller == request.user else call.caller
            
            call_data = {
                'call_id': str(call.call_id),
                'status': call.status,
                'call_type': call.call_type,
                'direction': 'outgoing' if call.caller == request.user else 'incoming',
                'other_user': {
                    'id': other_user.id,
                    'username': other_user.username,
                    'display_name': other_user.get_full_name() or other_user.username
                },
                'conversation_id': call.conversation.id,
                'initiated_at': call.initiated_at.isoformat(),
                'accepted_at': call.accepted_at.isoformat() if call.accepted_at else None,
                'ended_at': call.ended_at.isoformat() if call.ended_at else None,
                'duration': call.formatted_duration if call.duration else None
            }
            call_list.append(call_data)
        
        return JsonResponse({
            'success': True,
            'calls': call_list
        })
        
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})

@login_required
def call_interface(request, call_id):
    """Render the call interface page"""
    try:
        call = get_object_or_404(Call, call_id=call_id)
        
        # Verify user is a participant
        if call.caller != request.user and call.callee != request.user:
            raise Http404("Call not found")
        
        # Determine the other participant
        other_user = call.callee if call.caller == request.user else call.caller
        
        context = {
            'call': call,
            'other_user': other_user,
            'is_caller': call.caller == request.user,
            'call_data': {
                'call_id': str(call.call_id),
                'call_type': call.call_type,
                'status': call.status,
                'other_user_id': other_user.id,
                'other_user_name': other_user.username,
                'conversation_id': call.conversation.id
            }
        }
        
        return render(request, 'chat/call_interface.html', context)
        
    except Exception as e:
        return render(request, 'chat/error.html', {
            'error_message': f'Error loading call interface: {str(e)}'
        })

@login_required
@require_POST  
def mark_call_missed(request):
    """Mark a call as missed (for calls that weren't answered)"""
    try:
        data = json.loads(request.body)
        call_id = data.get('call_id')
        
        if not call_id:
            return JsonResponse({'success': False, 'error': 'Call ID required'})
        
        # Get call and verify user is the callee
        call = get_object_or_404(Call, call_id=call_id, callee=request.user)
        
        # Check if call can be marked as missed
        if call.status not in ['initiated', 'ringing']:
            return JsonResponse({'success': False, 'error': 'Call cannot be marked as missed'})
        
        # Mark as missed
        call.mark_as_missed()
        
        return JsonResponse({
            'success': True,
            'call_id': str(call.call_id),
            'status': call.status
        })
        
    except json.JSONDecodeError:
        return JsonResponse({'success': False, 'error': 'Invalid JSON'})
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)})
