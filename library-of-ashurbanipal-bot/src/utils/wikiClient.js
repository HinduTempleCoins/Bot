/**
 * MediaWiki API Client
 * Handles all interactions with the Library of Ashurbanipal wiki
 */

import axios from 'axios';

class WikiClient {
  constructor(wikiUrl, botUsername = null, botPassword = null) {
    this.apiUrl = wikiUrl.endsWith('/api.php') ? wikiUrl : `${wikiUrl}/api.php`;
    this.baseUrl = wikiUrl.replace('/api.php', '');
    this.botUsername = botUsername;
    this.botPassword = botPassword;
    this.cookies = {}; // Object for proper cookie merging
    this.editToken = null;
    this.loggedIn = false;
  }

  /**
   * Parse set-cookie headers into cookie object
   */
  parseCookies(setCookieHeaders) {
    if (!setCookieHeaders) return {};
    const cookies = {};
    for (const header of setCookieHeaders) {
      const [nameValue] = header.split(';');
      const [name, value] = nameValue.split('=');
      cookies[name] = value;
    }
    return cookies;
  }

  /**
   * Convert cookie object to header string
   */
  cookiesToString() {
    return Object.entries(this.cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  }

  /**
   * Make an API request to MediaWiki
   */
  async apiRequest(params, method = 'GET') {
    const cookieHeader = this.cookiesToString();
    const config = {
      method,
      url: this.apiUrl,
      params: method === 'GET' ? { ...params, format: 'json' } : { format: 'json' },
      data: method === 'POST' ? new URLSearchParams({ ...params, format: 'json' }) : undefined,
      headers: {
        'User-Agent': 'LibraryOfAshurbanipalBot/1.0 (Discord Wiki Bot)',
        ...(cookieHeader ? { Cookie: cookieHeader } : {})
      },
      timeout: 10000
    };

    try {
      const response = await axios(config);
      // Merge any new cookies (newer values overwrite older)
      Object.assign(this.cookies, this.parseCookies(response.headers['set-cookie']));
      return response.data;
    } catch (error) {
      console.error('[WikiClient] API error:', error.message);
      throw error;
    }
  }

  /**
   * Login to the wiki (required for editing)
   */
  async login() {
    if (!this.botUsername || !this.botPassword) {
      console.log('[WikiClient] No bot credentials provided, running in read-only mode');
      return false;
    }

    try {
      // Step 1: Get login token
      const tokenResponse = await axios.get(this.apiUrl, {
        params: {
          action: 'query',
          meta: 'tokens',
          type: 'login',
          format: 'json'
        },
        headers: {
          'User-Agent': 'LibraryOfAshurbanipalBot/1.0'
        }
      });

      const loginToken = tokenResponse.data.query.tokens.logintoken;
      Object.assign(this.cookies, this.parseCookies(tokenResponse.headers['set-cookie']));

      // Step 2: Login with cookies from token request
      const loginResponse = await axios.post(this.apiUrl, new URLSearchParams({
        action: 'login',
        lgname: this.botUsername,
        lgpassword: this.botPassword,
        lgtoken: loginToken,
        format: 'json'
      }), {
        headers: {
          'User-Agent': 'LibraryOfAshurbanipalBot/1.0',
          'Cookie': this.cookiesToString()
        }
      });

      if (loginResponse.data.login.result === 'Success') {
        Object.assign(this.cookies, this.parseCookies(loginResponse.headers['set-cookie']));
        this.loggedIn = true;
        console.log('[WikiClient] Logged in successfully');

        // Get edit token
        await this.getEditToken();
        return true;
      } else {
        console.error('[WikiClient] Login failed:', loginResponse.data.login.result, loginResponse.data.login);
        return false;
      }
    } catch (error) {
      console.error('[WikiClient] Login error:', error.message);
      return false;
    }
  }

  /**
   * Get edit token for making changes
   */
  async getEditToken() {
    const response = await this.apiRequest({
      action: 'query',
      meta: 'tokens',
      type: 'csrf'
    });

    this.editToken = response.query.tokens.csrftoken;
    return this.editToken;
  }

  /**
   * Search the wiki
   */
  async search(query, limit = 10) {
    const response = await this.apiRequest({
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: limit,
      srprop: 'snippet|titlesnippet|size|wordcount'
    });

    return response.query?.search || [];
  }

  /**
   * Get article content
   */
  async getArticle(title) {
    const response = await this.apiRequest({
      action: 'query',
      titles: title,
      prop: 'revisions|info',
      rvprop: 'content|timestamp',
      rvslots: 'main'
    });

    const pages = response.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    if (page.missing) return null;

    return {
      title: page.title,
      pageid: page.pageid,
      content: page.revisions?.[0]?.slots?.main?.['*'] || '',
      timestamp: page.revisions?.[0]?.timestamp,
      length: page.length
    };
  }

  /**
   * Get article summary (first section)
   */
  async getArticleSummary(title) {
    const response = await this.apiRequest({
      action: 'query',
      titles: title,
      prop: 'extracts',
      exintro: true,
      explaintext: true,
      exsectionformat: 'plain'
    });

    const pages = response.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    if (page.missing) return null;

    return {
      title: page.title,
      summary: page.extract || 'No summary available.'
    };
  }

  /**
   * Get recent changes from the wiki
   */
  async getRecentChanges(limit = 10) {
    const response = await this.apiRequest({
      action: 'query',
      list: 'recentchanges',
      rclimit: limit,
      rcprop: 'title|timestamp|user|comment|sizes',
      rctype: 'new|edit'
    });

    return response.query?.recentchanges || [];
  }

  /**
   * Create or edit an article
   */
  async editArticle(title, content, summary = 'Bot edit') {
    if (!this.loggedIn) {
      const success = await this.login();
      if (!success) {
        throw new Error('Cannot edit: Not logged in');
      }
    }

    // Always get a fresh edit token right before editing
    await this.getEditToken();

    const response = await axios.post(this.apiUrl, new URLSearchParams({
      action: 'edit',
      title,
      text: content,
      summary,
      token: this.editToken,
      format: 'json'
    }), {
      headers: {
        'User-Agent': 'LibraryOfAshurbanipalBot/1.0',
        Cookie: this.cookiesToString()
      }
    });

    // Merge any new cookies
    Object.assign(this.cookies, this.parseCookies(response.headers['set-cookie']));

    if (response.data.edit?.result === 'Success') {
      return {
        success: true,
        title: response.data.edit.title,
        newrevid: response.data.edit.newrevid
      };
    } else {
      throw new Error(`Edit failed: ${JSON.stringify(response.data)}`);
    }
  }

  /**
   * Get all pages in a category
   */
  async getCategoryMembers(category, limit = 50) {
    const response = await this.apiRequest({
      action: 'query',
      list: 'categorymembers',
      cmtitle: category.startsWith('Category:') ? category : `Category:${category}`,
      cmlimit: limit
    });

    return response.query?.categorymembers || [];
  }

  /**
   * Get wiki statistics
   */
  async getStatistics() {
    const response = await this.apiRequest({
      action: 'query',
      meta: 'siteinfo',
      siprop: 'statistics|general'
    });

    return {
      sitename: response.query?.general?.sitename,
      articles: response.query?.statistics?.articles,
      pages: response.query?.statistics?.pages,
      edits: response.query?.statistics?.edits,
      users: response.query?.statistics?.users
    };
  }

  /**
   * Check if an article exists
   */
  async articleExists(title) {
    const response = await this.apiRequest({
      action: 'query',
      titles: title
    });

    const pages = response.query?.pages;
    if (!pages) return false;

    const page = Object.values(pages)[0];
    return !page.missing;
  }

  /**
   * Get the URL for an article
   */
  getArticleUrl(title) {
    return `${this.baseUrl}/index.php/${encodeURIComponent(title.replace(/ /g, '_'))}`;
  }
}

export default WikiClient;
