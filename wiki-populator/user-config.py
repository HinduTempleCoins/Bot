# Pywikibot configuration for Library of Ashurbanipal wiki

# Wiki family and site
family = 'ashurbanipal'
mylang = 'en'

# Register the custom family
family_files['ashurbanipal'] = '/home/user/Bot/wiki-populator/families/ashurbanipal_family.py'

# Bot username
usernames['ashurbanipal']['en'] = 'LibraryBot'

# Password file location
password_file = '/home/user/Bot/wiki-populator/user-password.py'

# Throttle settings
put_throttle = 1

# User agent
user_agent_format = 'LibraryBot/1.0 (Pywikibot)'
