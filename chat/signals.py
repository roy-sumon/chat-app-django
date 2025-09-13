from django.db.models.signals import post_save
from django.dispatch import receiver
from django.contrib.auth.models import User
from .models import UserProfile

@receiver(post_save, sender=User)
def create_user_profile(sender, instance, created, **kwargs):
    """Automatically create a UserProfile when a new User is created"""
    if created:
        import hashlib
        name = (instance.get_full_name() or instance.username).replace(' ', '+')
        username_hash = hashlib.md5(instance.username.encode()).hexdigest()
        bg_color = username_hash[:6]
        
        UserProfile.objects.create(
            user=instance,
            avatar_url=f'https://ui-avatars.com/api/?background={bg_color}&color=ffffff&name={name}&size=128&font-size=0.33'
        )

@receiver(post_save, sender=User)
def save_user_profile(sender, instance, **kwargs):
    """Automatically save the UserProfile when the User is saved"""
    if hasattr(instance, 'userprofile'):
        instance.userprofile.save()
    else:
        # Create profile if it doesn't exist
        import hashlib
        name = (instance.get_full_name() or instance.username).replace(' ', '+')
        username_hash = hashlib.md5(instance.username.encode()).hexdigest()
        bg_color = username_hash[:6]
        
        UserProfile.objects.create(
            user=instance,
            avatar_url=f'https://ui-avatars.com/api/?background={bg_color}&color=ffffff&name={name}&size=128&font-size=0.33'
        )
