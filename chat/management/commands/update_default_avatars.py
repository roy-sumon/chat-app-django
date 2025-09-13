from django.core.management.base import BaseCommand
from django.contrib.auth.models import User
from chat.models import UserProfile
import hashlib

class Command(BaseCommand):
    help = 'Update existing users with proper default avatar URLs'

    def handle(self, *args, **options):
        self.stdout.write('Updating default avatars for existing users...')
        
        # Get all users
        users = User.objects.all()
        updated_count = 0
        
        for user in users:
            # Get or create profile
            profile, created = UserProfile.objects.get_or_create(user=user)
            
            # Update avatar_url if user doesn't have a custom avatar uploaded
            if not profile.avatar:
                name = (user.get_full_name() or user.username).replace(' ', '+')
                username_hash = hashlib.md5(user.username.encode()).hexdigest()
                bg_color = username_hash[:6]
                
                new_avatar_url = f'https://ui-avatars.com/api/?background={bg_color}&color=ffffff&name={name}&size=128&font-size=0.33'
                
                if profile.avatar_url != new_avatar_url:
                    profile.avatar_url = new_avatar_url
                    profile.save()
                    updated_count += 1
                    self.stdout.write(f'Updated avatar for user: {user.username}')
        
        self.stdout.write(
            self.style.SUCCESS(f'Successfully updated {updated_count} user avatars')
        )
