"""Family module for Library of Ashurbanipal wiki."""

import os

from pywikibot import family

class Family(family.Family):
    """Family class for Library of Ashurbanipal wiki."""

    name = 'ashurbanipal'

    # Host is environment-specific; set WIKI_HOST or edit before running.
    langs = {
        'en': os.environ.get('WIKI_HOST', 'localhost'),
    }

    def scriptpath(self, code):
        return '/wiki'

    def protocol(self, code):
        return 'http'
