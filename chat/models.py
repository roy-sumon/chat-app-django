from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
from PIL import Image
import os
import uuid
from django.core.validators import FileExtensionValidator
from django.core.exceptions import ValidationError

def user_directory_path(instance, filename):
    """Upload profile pictures to MEDIA_ROOT/profiles/user_<id>/"""
    return f'profiles/user_{instance.user.id}/{filename}'

def message_file_path(instance, filename):
    """Upload message files to MEDIA_ROOT/chat_files/conversation_<id>/"""
    # Generate unique filename to avoid conflicts
    ext = filename.split('.')[-1] if '.' in filename else ''
    unique_filename = f"{uuid.uuid4().hex}.{ext}" if ext else str(uuid.uuid4().hex)
    return f'chat_files/conversation_{instance.conversation.id}/{unique_filename}'

def validate_file_size(value):
    """Validate uploaded file size (max 10MB)"""
    filesize = value.size
    if filesize > 10 * 1024 * 1024:  # 10MB
        raise ValidationError('File size cannot exceed 10MB')

class UserProfile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE)
    avatar = models.ImageField(
        upload_to=user_directory_path,
        null=True,
        blank=True,
        help_text='Profile picture'
    )
    avatar_url = models.URLField(
        default='https://ui-avatars.com/api/?background=random&name=User',
        blank=True,
        help_text='Fallback avatar URL if no image is uploaded'
    )
    is_online = models.BooleanField(default=False)
    last_seen = models.DateTimeField(default=timezone.now)
    bio = models.TextField(max_length=500, blank=True)
    
    def __str__(self):
        return f"{self.user.username}'s Profile"
    
    @property
    def display_name(self):
        return self.user.get_full_name() or self.user.username
    
    def get_avatar_url(self):
        """Get the avatar URL, prioritizing uploaded image over fallback URL"""
        if self.avatar and hasattr(self.avatar, 'url'):
            return self.avatar.url
        elif self.avatar_url:
            return self.avatar_url
        else:
            # Generate default avatar URL with user's name and consistent color
            name = self.display_name.replace(' ', '+')
            import hashlib
            username_hash = hashlib.md5(self.user.username.encode()).hexdigest()
            bg_color = username_hash[:6]  # Use first 6 chars as hex color
            return f'https://ui-avatars.com/api/?background={bg_color}&color=ffffff&name={name}&size=128&font-size=0.33'
    
    def save(self, *args, **kwargs):
        """Override save to process uploaded images"""
        # Set default avatar_url if not set or if it's still the generic default
        if not self.avatar_url or self.avatar_url == 'https://ui-avatars.com/api/?background=random&name=User':
            name = self.display_name.replace(' ', '+')
            # Use a consistent background color based on username for better UX
            import hashlib
            username_hash = hashlib.md5(self.user.username.encode()).hexdigest()
            bg_color = username_hash[:6]  # Use first 6 chars as hex color
            self.avatar_url = f'https://ui-avatars.com/api/?background={bg_color}&color=ffffff&name={name}&size=128&font-size=0.33'
        
        super().save(*args, **kwargs)
        
        # Process uploaded image only if there's an actual file
        if self.avatar and hasattr(self.avatar, 'path') and self.avatar.name:
            try:
                self.resize_avatar()
            except Exception as e:
                print(f"Error processing avatar for user {self.user.username}: {e}")
    
    def resize_avatar(self):
        """Resize uploaded avatar to reasonable dimensions"""
        try:
            img = Image.open(self.avatar.path)
            
            # Convert RGBA to RGB if necessary
            if img.mode == 'RGBA':
                img = img.convert('RGB')
            
            # Resize image if it's too large
            max_size = (300, 300)
            if img.height > max_size[0] or img.width > max_size[1]:
                img.thumbnail(max_size, Image.Resampling.LANCZOS)
                img.save(self.avatar.path, quality=90, optimize=True)
        except Exception as e:
            print(f"Error processing avatar for user {self.user.username}: {e}")
    
    def delete_avatar(self):
        """Delete the uploaded avatar file"""
        if self.avatar:
            try:
                if os.path.isfile(self.avatar.path):
                    os.remove(self.avatar.path)
            except Exception as e:
                print(f"Error deleting avatar file: {e}")
            self.avatar = None
            self.save()

class Conversation(models.Model):
    participants = models.ManyToManyField(User, related_name='conversations')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-updated_at']
    
    def __str__(self):
        return f"Conversation {self.id}"
    
    @property
    def last_message(self):
        return self.messages.order_by('-timestamp').first()
    
    def other_participant(self, user):
        return self.participants.exclude(id=user.id).first()

class Message(models.Model):
    MESSAGE_STATUS_CHOICES = [
        ('sent', 'Sent'),
        ('delivered', 'Delivered'),
        ('read', 'Read'),
    ]
    
    MESSAGE_TYPE_CHOICES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('file', 'File'),
    ]
    
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(User, on_delete=models.CASCADE, related_name='sent_messages')
    content = models.TextField(blank=True)  # Make content optional for file messages
    message_type = models.CharField(max_length=10, choices=MESSAGE_TYPE_CHOICES, default='text')
    
    # File attachment fields
    file = models.FileField(
        upload_to=message_file_path,
        null=True,
        blank=True,
        validators=[
            validate_file_size,
            FileExtensionValidator(allowed_extensions=[
                # Images
                'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
                # Documents
                'pdf', 'doc', 'docx', 'txt', 'rtf',
                # Spreadsheets
                'xls', 'xlsx', 'csv',
                # Presentations
                'ppt', 'pptx',
                # Archives
                'zip', 'rar', '7z',
                # Audio
                'mp3', 'wav', 'ogg', 'aac',
                # Video
                'mp4', 'avi', 'mov', 'webm'
            ])
        ]
    )
    file_name = models.CharField(max_length=255, blank=True)  # Original filename
    file_size = models.PositiveIntegerField(null=True, blank=True)  # File size in bytes
    
    timestamp = models.DateTimeField(auto_now_add=True)
    status = models.CharField(max_length=10, choices=MESSAGE_STATUS_CHOICES, default='sent')
    is_edited = models.BooleanField(default=False)
    edited_at = models.DateTimeField(null=True, blank=True)
    is_deleted = models.BooleanField(default=False)
    deleted_at = models.DateTimeField(null=True, blank=True)
    deleted_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='deleted_messages')
    
    class Meta:
        ordering = ['timestamp']
    
    def __str__(self):
        return f"{self.sender.username}: {self.content[:50]}"
    
    def mark_as_delivered(self):
        if self.status == 'sent':
            self.status = 'delivered'
            self.save()
    
    def mark_as_read(self):
        if self.status in ['sent', 'delivered']:
            self.status = 'read'
            self.save()
    
    def soft_delete(self, user):
        """Soft delete a message"""
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.deleted_by = user
        self.save()
    
    def restore(self):
        """Restore a soft deleted message"""
        self.is_deleted = False
        self.deleted_at = None
        self.deleted_by = None
        self.save()
    
    @property
    def display_content(self):
        """Return appropriate content for display"""
        if self.is_deleted:
            return "This message was deleted"
        return self.content
    
    @property
    def is_image(self):
        """Check if the attached file is an image"""
        if not self.file:
            return False
        image_extensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']
        file_ext = self.file.name.split('.')[-1].lower() if '.' in self.file.name else ''
        return file_ext in image_extensions
    
    @property
    def file_extension(self):
        """Get file extension"""
        if not self.file:
            return ''
        return self.file.name.split('.')[-1].lower() if '.' in self.file.name else ''
    
    def get_file_icon(self):
        """Return appropriate icon class based on file type"""
        if not self.file:
            return 'file-text'
        
        ext = self.file_extension
        
        # Images
        if ext in ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']:
            return 'image'
        # Documents
        elif ext in ['pdf']:
            return 'file-pdf'
        elif ext in ['doc', 'docx']:
            return 'file-word'
        elif ext in ['xls', 'xlsx']:
            return 'file-excel'
        elif ext in ['ppt', 'pptx']:
            return 'file-powerpoint'
        # Archives
        elif ext in ['zip', 'rar', '7z']:
            return 'file-archive'
        # Audio
        elif ext in ['mp3', 'wav', 'ogg', 'aac']:
            return 'music'
        # Video
        elif ext in ['mp4', 'avi', 'mov', 'webm']:
            return 'video'
        else:
            return 'file-text'
    
    def format_file_size(self):
        """Format file size in human readable format"""
        if not self.file_size:
            return ''
        
        size = self.file_size
        for unit in ['B', 'KB', 'MB', 'GB']:
            if size < 1024.0:
                return f"{size:.1f} {unit}"
            size /= 1024.0
        return f"{size:.1f} TB"
    
    def save(self, *args, **kwargs):
        """Override save to set file metadata"""
        if self.file:
            # Set message type based on file
            if self.is_image:
                self.message_type = 'image'
            else:
                self.message_type = 'file'
            
            # Set file metadata if not already set
            if not self.file_name:
                self.file_name = os.path.basename(self.file.name)
            if not self.file_size:
                self.file_size = self.file.size
        
        super().save(*args, **kwargs)

class TypingStatus(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    is_typing = models.BooleanField(default=False)
    timestamp = models.DateTimeField(auto_now=True)
    
    class Meta:
        unique_together = ['conversation', 'user']
    
    def __str__(self):
        return f"{self.user.username} typing in {self.conversation.id}"

class MessageReaction(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    emoji = models.CharField(max_length=10)  # Store emoji like '😀', '👍', etc.
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['message', 'user', 'emoji']
        ordering = ['created_at']
    
    def __str__(self):
        return f"{self.user.username} reacted {self.emoji} to message {self.message.id}"

class MessageEdit(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='edits')
    old_content = models.TextField()
    new_content = models.TextField()
    edited_by = models.ForeignKey(User, on_delete=models.CASCADE)
    edited_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-edited_at']
    
    def __str__(self):
        return f"Edit by {self.edited_by.username} on message {self.message.id}"

class ConversationDeletion(models.Model):
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='deletions')
    deleted_by = models.ForeignKey(User, on_delete=models.CASCADE)
    deleted_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['conversation', 'deleted_by']
        ordering = ['-deleted_at']
    
    def __str__(self):
        return f"Conversation {self.conversation.id} deleted by {self.deleted_by.username}"
