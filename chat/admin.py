from django.contrib import admin
from .models import UserProfile, Conversation, Message, TypingStatus, Call

@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ['user', 'display_name', 'is_online', 'last_seen']
    list_filter = ['is_online', 'last_seen']
    search_fields = ['user__username', 'user__email']

@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ['id', 'created_at', 'updated_at']
    list_filter = ['created_at', 'updated_at']
    filter_horizontal = ['participants']

@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ['sender', 'conversation', 'content', 'timestamp', 'status']
    list_filter = ['status', 'timestamp', 'is_edited']
    search_fields = ['content', 'sender__username']
    readonly_fields = ['timestamp']

@admin.register(TypingStatus)
class TypingStatusAdmin(admin.ModelAdmin):
    list_display = ['user', 'conversation', 'is_typing', 'timestamp']
    list_filter = ['is_typing', 'timestamp']

@admin.register(Call)
class CallAdmin(admin.ModelAdmin):
    list_display = ['call_id', 'caller', 'callee', 'call_type', 'status', 'initiated_at', 'duration']
    list_filter = ['call_type', 'status', 'initiated_at']
    search_fields = ['caller__username', 'callee__username']
    readonly_fields = ['call_id', 'initiated_at', 'accepted_at', 'ended_at', 'duration']
    
    def get_readonly_fields(self, request, obj=None):
        if obj:  # Editing existing call
            return self.readonly_fields + ['caller', 'callee', 'conversation', 'call_type']
        return self.readonly_fields
