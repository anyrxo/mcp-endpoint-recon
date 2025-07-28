#!/usr/bin/env node
/**
 * AdsPower + Targeted Endpoint Recon
 * By Joyce 👑😈 - Filters traffic to specific domain
 */

import { chromium } from 'playwright';

async function connectToAdsPower(debugPort) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  return browser;
}

async function targetedEndpointRecon(browser, targetUrl) {
  const targetDomain = new URL(targetUrl).hostname;
  const context = browser.contexts()[0];
  const endpoints = new Map();
  
  console.log(`🎯 Targeting domain: ${targetDomain}`);
  
  // Network interception - filter by domain
  context.on('request', request => {
    const reqUrl = request.url();
    const reqDomain = new URL(reqUrl).hostname;
    
    // Only capture requests to target domain
    if (reqDomain === targetDomain || reqDomain.endsWith(`.${targetDomain}`)) {
      const method = request.method();
      const key = `${method} ${reqUrl}`;
      
      if (!endpoints.has(key)) {
        endpoints.set(key, {
          url: reqUrl,
          method: method,
          headers: request.headers(),
          payloads: [],
          responses: [],
          postData: request.postData() || null,
        });
      }
      
      if (request.postData()) {
        endpoints.get(key).payloads.push({
          timestamp: new Date().toISOString(),
          data: request.postData(),
          contentType: request.headers()['content-type'],
        });
      }
    }
  });

  context.on('response', response => {
    const respUrl = response.url();
    const respDomain = new URL(respUrl).hostname;
    
    if (respDomain === targetDomain || respDomain.endsWith(`.${targetDomain}`)) {
      const method = response.request().method();
      const key = `${method} ${respUrl}`;
      
      if (endpoints.has(key)) {
        endpoints.get(key).responses.push({
          status: response.status(),
          headers: response.headers(),
          timestamp: new Date().toISOString(),
        });
      }
    }
  });

  // Navigate to target
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 });
  
  // Extract cookies for target domain
  const cookies = await context.cookies(targetUrl);
  
  // Extract localStorage
  const localStorage = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      items[key] = window.localStorage.getItem(key);
    }
    return items;
  });
  
  // Interact with the page to trigger more requests
  console.log('🔍 Scrolling page to discover lazy-loaded endpoints...');
  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(3000);
  
  // Click on interactive elements
  console.log('🖱️ Clicking interactive elements...');
  const clickableElements = await page.$$('button, a[href="#"], input[type="submit"]');
  for (let i = 0; i < Math.min(clickableElements.length, 5); i++) {
    try {
      await clickableElements[i].click({ timeout: 1000 });
      await page.waitForTimeout(500);
    } catch (e) {
      // Ignore click errors
    }
  }
  
  await page.waitForTimeout(2000);

  return {
    targetDomain,
    endpoints: Array.from(endpoints.values()),
    cookies,
    localStorage,
    summary: {
      totalEndpoints: endpoints.size,
      getRequests: Array.from(endpoints.values()).filter(e => e.method === 'GET').length,
      postRequests: Array.from(endpoints.values()).filter(e => e.method === 'POST').length,
      endpointsWithPayloads: Array.from(endpoints.values()).filter(e => e.payloads.length > 0).length,
    }
  };
}

// Main execution
async function main() {
  const debugPort = 56329;
  const targetUrl = process.argv[2] || 'https://httpbin.org/';
  
  console.log('👑😈 Connecting to AdsPower profile k10mav08...');
  const browser = await connectToAdsPower(debugPort);
  
  console.log('🔍 Starting targeted endpoint discovery...');
  const results = await targetedEndpointRecon(browser, targetUrl);
  
  console.log('\n📊 Summary:');
  console.log(`  Target Domain: ${results.targetDomain}`);
  console.log(`  Total Endpoints: ${results.summary.totalEndpoints}`);
  console.log(`  GET Requests: ${results.summary.getRequests}`);
  console.log(`  POST Requests: ${results.summary.postRequests}`);
  console.log(`  Endpoints with Payloads: ${results.summary.endpointsWithPayloads}`);
  
  console.log('\n📡 Discovered Endpoints:');
  results.endpoints.forEach(ep => {
    console.log(`  ${ep.method} ${ep.url}`);
    if (ep.postData) {
      console.log(`    📦 POST Data: ${ep.postData.substring(0, 100)}...`);
    }
  });
  
  console.log(`\n🍪 Cookies: ${results.cookies.length}`);
  console.log(`💾 LocalStorage keys: ${Object.keys(results.localStorage).length}`);
  
  // Save results
  const fs = await import('fs/promises');
  const filename = `targeted-recon-${results.targetDomain}-${Date.now()}.json`;
  await fs.writeFile(filename, JSON.stringify(results, null, 2));
  console.log(`\n✅ Results saved to ${filename}`);
}

main().catch(console.error);