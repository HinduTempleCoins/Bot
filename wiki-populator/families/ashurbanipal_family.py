"""Family module for Library of Ashurbanipal wiki."""

from pywikibot import family

class Family(family.Family):
    """Family class for Library of Ashurbanipal wiki."""

    name = 'ashurbanipal'

    langs = {
        'en': '5.252.53.79',
    }

    def scriptpath(self, code):
        return '/wiki'

    def protocol(self, code):
        return 'http'
