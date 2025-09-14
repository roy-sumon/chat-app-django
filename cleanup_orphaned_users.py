#!/usr/bin/env python
import os
import sys
import django

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'chatproject.settings')
django.setup()

from django.contrib.auth.models import User
from chat.models import UserProfile

# Find and clean up orphaned users (users without profiles)
orphaned_users = User.objects.exclude(userprofile__isnull=False)
print(f"Found {orphaned_users.count()} orphaned users")

for user in orphaned_users:
    print(f"Deleting orphaned user: {user.id} - {user.username}")
    user.delete()

print("Cleanup complete")
