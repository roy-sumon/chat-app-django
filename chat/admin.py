from django.contrib import admin
from .models import UserProfile, Conversation, Message, TypingStatus

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
