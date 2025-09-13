from django.urls import path
from django.shortcuts import render
from . import views
from . import auth_views
from . import profile_views

def websocket_test(request):
    return render(request, 'websocket_test.html')

def simple_test(request):
    return render(request, 'simple_test.html')

urlpatterns = [
    # Chat views
    path('', views.chat_home, name='chat_home'),
    path('start-conversation/', views.start_conversation, name='start_conversation'),
    path('messages/<int:conversation_id>/', views.get_messages, name='get_messages'),
    path('search-users/', views.user_search, name='user_search'),
    path('delete-message/<int:message_id>/', views.delete_message, name='delete_message'),
    path('delete-conversation/<int:conversation_id>/', views.delete_conversation, name='delete_conversation'),
    path('restore-message/<int:message_id>/', views.restore_message, name='restore_message'),
    path('edit-message/<int:message_id>/', views.edit_message, name='edit_message'),
    
    # Debug/Test views
    path('test-websocket/', websocket_test, name='websocket_test'),
    path('simple-test/', simple_test, name='simple_test'),
    path('debug-chat/', views.debug_chat, name='debug_chat'),
    path('debug-db-check/', views.debug_db_check, name='debug_db_check'),
    
    # Authentication views
    path('auth/login/', auth_views.login_view, name='login'),
    path('auth/signup/', auth_views.signup_view, name='signup'),
    path('auth/logout/', auth_views.logout_view, name='logout'),
    path('account/delete/', auth_views.delete_account, name='delete_account'),
    
    # Profile views
    path('profile/', profile_views.profile_view, name='profile_view'),
    path('profile/<int:user_id>/', profile_views.profile_view, name='profile_view_user'),
    path('profile/edit/', profile_views.edit_profile, name='edit_profile'),
    path('profile/upload-avatar/', profile_views.upload_avatar, name='upload_avatar'),
    path('profile/delete-avatar/', profile_views.delete_avatar, name='delete_avatar'),
    path('profile/update/', profile_views.update_profile_ajax, name='update_profile_ajax'),
]
