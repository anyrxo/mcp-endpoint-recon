#!/usr/bin/env node
/**
 * Instagram API Deep Recon
 * By Joyce 👑😈 - Specialized Instagram endpoint discovery
 */

import { chromium } from 'playwright';
import fs from 'fs/promises';

class InstagramAPIRecon {
  constructor(debugPort) {
    this.debugPort = debugPort;
    this.endpoints = new Map();
    this.graphqlQueries = new Map();
    this.ajaxCalls = new Map();
    this.cookies = new Map();
    this.localStorage = {};
    this.sessionStorage = {};
    this.csrfToken = null;
    this.userId = null;
    this.rolloutHash = null;
  }

  async connect() {
    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.debugPort}`);
    this.context = this.browser.contexts()[0];
    this.setupNetworkInterception();
  }

  setupNetworkInterception() {
    this.context.on('request', request => {
      const url = request.url();
      const method = request.method();
      
      // Capture Instagram-specific endpoints
      if (url.includes('instagram.com')) {
        const endpoint = this.categorizeEndpoint(url);
        
        if (endpoint.type !== 'static') {
          const key = `${method} ${endpoint.path}`;
          
          if (!this.endpoints.has(key)) {
            this.endpoints.set(key, {
              url,
              method,
              type: endpoint.type,
              category: endpoint.category,
              headers: request.headers(),
              cookies: [],
              payloads: [],
              responses: [],
              timing: new Date().toISOString()
            });
          }
          
          // Capture request payload
          if (request.postData()) {
            const data = this.parsePayload(request.postData());
            this.endpoints.get(key).payloads.push({
              timestamp: new Date().toISOString(),
              data,
              raw: request.postData()
            });
            
            // Extract important tokens
            if (data.fb_dtsg) this.csrfToken = data.fb_dtsg;
            if (data.doc_id) this.trackGraphQLQuery(data.doc_id, data);
          }
        }
      }
    });

    this.context.on('response', async response => {
      const url = response.url();
      const method = response.request().method();
      
      if (url.includes('instagram.com')) {
        const endpoint = this.categorizeEndpoint(url);
        
        if (endpoint.type !== 'static') {
          const key = `${method} ${endpoint.path}`;
          
          if (this.endpoints.has(key)) {
            let responseData = null;
            try {
              const contentType = response.headers()['content-type'] || '';
              if (contentType.includes('json')) {
                responseData = await response.json();
                
                // Extract user data
                if (responseData.data?.user?.id) {
                  this.userId = responseData.data.user.id;
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
            
            this.endpoints.get(key).responses.push({
              status: response.status(),
              statusText: response.statusText(),
              headers: response.headers(),
              data: responseData,
              timestamp: new Date().toISOString()
            });
          }
        }
      }
    });
  }

  categorizeEndpoint(url) {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    
    // GraphQL endpoints
    if (path.includes('/graphql/query') || path.includes('/api/graphql')) {
      return { type: 'graphql', category: 'data-fetching', path };
    }
    
    // AJAX endpoints
    if (path.includes('/ajax/')) {
      if (path.includes('/bz')) return { type: 'ajax', category: 'logging', path };
      if (path.includes('/bootloader')) return { type: 'ajax', category: 'code-loading', path };
      return { type: 'ajax', category: 'general', path };
    }
    
    // API v1 endpoints
    if (path.includes('/api/v1/')) {
      if (path.includes('/feed')) return { type: 'api', category: 'feed', path };
      if (path.includes('/users')) return { type: 'api', category: 'users', path };
      if (path.includes('/media')) return { type: 'api', category: 'media', path };
      if (path.includes('/friendships')) return { type: 'api', category: 'relationships', path };
      if (path.includes('/discover')) return { type: 'api', category: 'discovery', path };
      return { type: 'api', category: 'other', path };
    }
    
    // Web API endpoints
    if (path.includes('/web/')) {
      if (path.includes('/comments')) return { type: 'web', category: 'comments', path };
      if (path.includes('/likes')) return { type: 'web', category: 'engagement', path };
      if (path.includes('/search')) return { type: 'web', category: 'search', path };
      return { type: 'web', category: 'other', path };
    }
    
    // Static resources
    if (path.includes('/static/') || path.endsWith('.js') || path.endsWith('.css')) {
      return { type: 'static', category: 'resources', path };
    }
    
    return { type: 'other', category: 'unknown', path };
  }

  parsePayload(data) {
    try {
      return JSON.parse(data);
    } catch {
      // Parse URL encoded data
      const params = new URLSearchParams(data);
      const obj = {};
      for (const [key, value] of params) {
        try {
          obj[key] = JSON.parse(value);
        } catch {
          obj[key] = value;
        }
      }
      return obj;
    }
  }

  trackGraphQLQuery(docId, variables) {
    if (!this.graphqlQueries.has(docId)) {
      this.graphqlQueries.set(docId, {
        docId,
        examples: [],
        purpose: this.inferGraphQLPurpose(variables)
      });
    }
    this.graphqlQueries.get(docId).examples.push(variables);
  }

  inferGraphQLPurpose(variables) {
    const varStr = JSON.stringify(variables).toLowerCase();
    
    if (varStr.includes('feed')) return 'Feed Data';
    if (varStr.includes('story')) return 'Stories';
    if (varStr.includes('reel')) return 'Reels';
    if (varStr.includes('user') && varStr.includes('id')) return 'User Profile';
    if (varStr.includes('media')) return 'Media Details';
    if (varStr.includes('comment')) return 'Comments';
    if (varStr.includes('like')) return 'Likes';
    if (varStr.includes('follow')) return 'Following/Followers';
    if (varStr.includes('search')) return 'Search';
    
    return 'Unknown Query';
  }

  async extractInstagramData(page) {
    // Extract page data
    const pageData = await page.evaluate(() => {
      const data = {
        config: window._sharedData?.config || {},
        user: window._sharedData?.config?.viewer || null,
        csrf: window._sharedData?.config?.csrf_token || null,
        rollout: window._sharedData?.rollout_hash || null,
        locale: window._sharedData?.locale || null,
        featureFlags: window._sharedData?.to_cache || {}
      };
      
      // Extract from Redux store if available
      if (window.__REDUX_STATE__) {
        data.redux = {
          users: Object.keys(window.__REDUX_STATE__.users || {}),
          posts: Object.keys(window.__REDUX_STATE__.posts || {}),
          stories: Object.keys(window.__REDUX_STATE__.stories || {})
        };
      }
      
      return data;
    });
    
    if (pageData.csrf) this.csrfToken = pageData.csrf;
    if (pageData.rollout) this.rolloutHash = pageData.rollout;
    if (pageData.user?.id) this.userId = pageData.user.id;
    
    // Extract cookies
    const cookies = await this.context.cookies();
    cookies.forEach(cookie => {
      this.cookies.set(cookie.name, cookie);
    });
    
    // Extract storage
    const storage = await page.evaluate(() => ({
      local: Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, i) => {
          const key = localStorage.key(i);
          return [key, localStorage.getItem(key)];
        })
      ),
      session: Object.fromEntries(
        Array.from({ length: sessionStorage.length }, (_, i) => {
          const key = sessionStorage.key(i);
          return [key, sessionStorage.getItem(key)];
        })
      )
    }));
    
    this.localStorage = storage.local;
    this.sessionStorage = storage.session;
  }

  async crawlInstagram() {
    const page = await this.context.newPage();
    
    console.log('📱 Loading Instagram...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle' });
    
    // Extract initial data
    await this.extractInstagramData(page);
    
    // Try different Instagram pages
    const pagesToVisit = [
      { url: 'https://www.instagram.com/', action: 'scroll feed' },
      { url: 'https://www.instagram.com/explore/', action: 'explore page' },
      { url: 'https://www.instagram.com/reels/', action: 'reels' },
      { url: 'https://www.instagram.com/direct/inbox/', action: 'messages' }
    ];
    
    for (const { url, action } of pagesToVisit) {
      try {
        console.log(`📍 Visiting ${action}...`);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        
        // Interact with the page
        await this.interactWithInstagram(page, action);
        
        // Wait for API calls
        await page.waitForTimeout(3000);
      } catch (e) {
        console.log(`⚠️ Could not visit ${action}: ${e.message}`);
      }
    }
    
    await page.close();
  }

  async interactWithInstagram(page, action) {
    switch (action) {
      case 'scroll feed':
        // Scroll through feed to trigger API calls
        for (let i = 0; i < 5; i++) {
          await page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await page.waitForTimeout(2000);
        }
        break;
        
      case 'explore page':
        // Click on some explore items
        const exploreItems = await page.$$('article a');
        for (let i = 0; i < Math.min(3, exploreItems.length); i++) {
          try {
            await exploreItems[i].click();
            await page.waitForTimeout(2000);
            await page.keyboard.press('Escape');
          } catch {}
        }
        break;
        
      case 'reels':
        // Navigate through reels
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press('ArrowDown');
          await page.waitForTimeout(2000);
        }
        break;
    }
  }

  generateMarkdown() {
    const timestamp = new Date().toISOString();
    
    let md = `# 🔍 Instagram API Reconnaissance Report\n\n`;
    md += `**Scan Date:** ${timestamp}  \n`;
    md += `**User ID:** ${this.userId || 'Not logged in'}  \n`;
    md += `**CSRF Token:** ${this.csrfToken ? '✅ Captured' : '❌ Not found'}  \n`;
    md += `**Total Endpoints:** ${this.endpoints.size}  \n\n`;
    
    // Critical Information
    md += `## 🔐 Critical Authentication Data\n\n`;
    md += `### CSRF Token\n`;
    if (this.csrfToken) {
      md += `\`\`\`\n${this.csrfToken}\n\`\`\`\n\n`;
      md += `**Usage:** Include in all POST requests as \`fb_dtsg\` parameter\n\n`;
    }
    
    md += `### Important Cookies\n\n`;
    const importantCookies = ['csrftoken', 'sessionid', 'ds_user_id', 'ig_did'];
    md += `| Cookie | Value | Purpose |\n`;
    md += `|--------|-------|----------|\n`;
    importantCookies.forEach(name => {
      const cookie = this.cookies.get(name);
      if (cookie) {
        const value = cookie.value.length > 30 ? cookie.value.substring(0, 30) + '...' : cookie.value;
        md += `| ${name} | ${value} | ${this.getCookiePurpose(name)} |\n`;
      }
    });
    md += `\n`;
    
    // GraphQL Endpoints
    md += `## 📊 GraphQL Endpoints\n\n`;
    md += `Instagram uses GraphQL for most data fetching. Each query has a unique \`doc_id\`.\n\n`;
    
    const graphqlEndpoints = Array.from(this.endpoints.entries())
      .filter(([_, data]) => data.type === 'graphql');
    
    if (graphqlEndpoints.length > 0) {
      md += `### Discovered GraphQL Queries\n\n`;
      this.graphqlQueries.forEach((query, docId) => {
        md += `#### Query ${docId} - ${query.purpose}\n\n`;
        if (query.examples.length > 0) {
          md += `**Example Variables:**\n\`\`\`json\n${JSON.stringify(query.examples[0], null, 2)}\n\`\`\`\n\n`;
        }
      });
    }
    
    // API Endpoints by Category
    md += `## 🚀 API Endpoints by Category\n\n`;
    
    const categorized = this.categorizeEndpoints();
    Object.entries(categorized).forEach(([category, endpoints]) => {
      if (endpoints.length > 0) {
        md += `### ${category}\n\n`;
        endpoints.forEach(([key, data]) => {
          md += `#### ${data.method} ${data.url}\n\n`;
          md += `**Type:** ${data.type}  \n`;
          md += `**Category:** ${data.category}  \n`;
          
          if (data.payloads.length > 0) {
            md += `**Request Payload Example:**\n\`\`\`json\n${JSON.stringify(data.payloads[0].data, null, 2)}\n\`\`\`\n\n`;
          }
          
          if (data.responses.length > 0 && data.responses[0].data) {
            md += `**Response Example:**\n\`\`\`json\n${JSON.stringify(data.responses[0].data, null, 2).substring(0, 500)}...\n\`\`\`\n\n`;
          }
          
          md += `---\n\n`;
        });
      }
    });
    
    // How to Use These Endpoints
    md += `## 💡 How to Use These Endpoints\n\n`;
    md += `### Required Headers\n\n`;
    md += `\`\`\`json\n`;
    md += `{\n`;
    md += `  "x-csrftoken": "${this.csrfToken || 'YOUR_CSRF_TOKEN'}",\n`;
    md += `  "x-ig-app-id": "936619743392459",\n`;
    md += `  "x-instagram-ajax": "${this.rolloutHash || 'ROLLOUT_HASH'}",\n`;
    md += `  "x-requested-with": "XMLHttpRequest",\n`;
    md += `  "content-type": "application/x-www-form-urlencoded"\n`;
    md += `}\n`;
    md += `\`\`\`\n\n`;
    
    md += `### Example API Call\n\n`;
    md += `\`\`\`python\n`;
    md += `import requests\n\n`;
    md += `# Get user feed\n`;
    md += `response = requests.post(\n`;
    md += `    'https://www.instagram.com/graphql/query',\n`;
    md += `    headers=headers,\n`;
    md += `    data={\n`;
    md += `        'doc_id': 'QUERY_ID_HERE',\n`;
    md += `        'variables': json.dumps({'count': 12}),\n`;
    md += `        'fb_dtsg': csrf_token\n`;
    md += `    },\n`;
    md += `    cookies=cookies\n`;
    md += `)\n`;
    md += `\`\`\`\n\n`;
    
    // Storage Data
    md += `## 💾 Storage Data\n\n`;
    const relevantStorage = Object.entries(this.localStorage)
      .filter(([key]) => !key.startsWith('ig_ca_') && !key.includes('LoggingFalcoEvent'));
    
    if (relevantStorage.length > 0) {
      md += `### Relevant LocalStorage\n\n`;
      md += `\`\`\`json\n`;
      md += JSON.stringify(Object.fromEntries(relevantStorage), null, 2);
      md += `\n\`\`\`\n\n`;
    }
    
    return md;
  }

  getCookiePurpose(name) {
    const purposes = {
      'csrftoken': 'CSRF protection token',
      'sessionid': 'User session identifier',
      'ds_user_id': 'User ID for data server',
      'ig_did': 'Device identifier',
      'rur': 'Routing update record',
      'mid': 'Machine identifier'
    };
    return purposes[name] || 'Unknown';
  }

  categorizeEndpoints() {
    const categories = {
      'Feed APIs': [],
      'User APIs': [],
      'Media APIs': [],
      'GraphQL Queries': [],
      'Analytics/Logging': [],
      'Other APIs': []
    };
    
    this.endpoints.forEach((data, key) => {
      if (data.type === 'graphql') {
        categories['GraphQL Queries'].push([key, data]);
      } else if (data.category === 'feed') {
        categories['Feed APIs'].push([key, data]);
      } else if (data.category === 'users' || data.category === 'relationships') {
        categories['User APIs'].push([key, data]);
      } else if (data.category === 'media' || data.category === 'comments' || data.category === 'engagement') {
        categories['Media APIs'].push([key, data]);
      } else if (data.category === 'logging') {
        categories['Analytics/Logging'].push([key, data]);
      } else {
        categories['Other APIs'].push([key, data]);
      }
    });
    
    return categories;
  }

  async saveReport(filename) {
    const markdown = this.generateMarkdown();
    await fs.writeFile(filename, markdown);
    console.log(`\n✅ Instagram API report saved to ${filename}`);
    
    // Save raw data
    const jsonData = {
      endpoints: Array.from(this.endpoints.entries()),
      graphqlQueries: Array.from(this.graphqlQueries.entries()),
      cookies: Array.from(this.cookies.values()),
      localStorage: this.localStorage,
      sessionStorage: this.sessionStorage,
      authentication: {
        csrfToken: this.csrfToken,
        userId: this.userId,
        rolloutHash: this.rolloutHash
      }
    };
    
    const jsonFilename = filename.replace('.md', '.json');
    await fs.writeFile(jsonFilename, JSON.stringify(jsonData, null, 2));
    console.log(`📦 Raw data saved to ${jsonFilename}`);
  }
}

// Main
async function main() {
  const debugPort = 56329;
  
  console.log('👑😈 Instagram API Deep Recon Starting...');
  console.log('🔐 This will capture authentication tokens, API endpoints, and GraphQL queries');
  
  const recon = new InstagramAPIRecon(debugPort);
  await recon.connect();
  
  await recon.crawlInstagram();
  
  const filename = `instagram-api-recon-${Date.now()}.md`;
  await recon.saveReport(filename);
  
  console.log('\n🎉 Instagram API reconnaissance complete!');
  console.log('⚡ Use the captured CSRF token and cookies for API automation');
}

main().catch(console.error);