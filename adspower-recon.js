#!/usr/bin/env node
/**
 * AdsPower + Endpoint Recon Integration
 * By Joyce 👑😈
 */

import { chromium } from 'playwright';
import fetch from 'node-fetch';

async function connectToAdsPower(debugPort) {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
  return browser;
}

async function discoverEndpoints(browser, url, options = {}) {
  const { depth = 2, capturePayloads = true } = options;
  
  const context = browser.contexts()[0];
  const endpoints = new Map();
  const visitedUrls = new Set();
  
  // Network interception
  context.on('request', request => {
    const reqUrl = request.url();
    const method = request.method();
    
    if (!endpoints.has(reqUrl)) {
      endpoints.set(reqUrl, {
        url: reqUrl,
        method: method,
        headers: request.headers(),
        payloads: [],
        responses: [],
      });
    }

    if (capturePayloads && request.postData()) {
      endpoints.get(reqUrl).payloads.push({
        timestamp: new Date().toISOString(),
        data: request.postData(),
        contentType: request.headers()['content-type'],
      });
    }
  });

  context.on('response', response => {
    const respUrl = response.url();
    if (endpoints.has(respUrl)) {
      endpoints.get(respUrl).responses.push({
        status: response.status(),
        headers: response.headers(),
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Navigate and collect
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  
  // Extract cookies
  const cookies = await context.cookies();
  
  // Extract localStorage
  const localStorage = await page.evaluate(() => {
    const items = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      items[key] = window.localStorage.getItem(key);
    }
    return items;
  });

  // Wait a bit for any async requests
  await page.waitForTimeout(5000);

  return {
    endpoints: Array.from(endpoints.values()),
    cookies,
    localStorage,
    visitedUrls: Array.from(visitedUrls),
  };
}

// Main execution
async function main() {
  const debugPort = 56329; // From AdsPower response
  const targetUrl = process.argv[2] || 'https://example.com';
  
  console.log('👑😈 Connecting to AdsPower profile k10mav08...');
  const browser = await connectToAdsPower(debugPort);
  
  console.log('🔍 Discovering endpoints on:', targetUrl);
  const results = await discoverEndpoints(browser, targetUrl);
  
  console.log('\n📡 Discovered Endpoints:');
  results.endpoints.forEach(ep => {
    console.log(`  ${ep.method} ${ep.url}`);
    if (ep.payloads.length > 0) {
      console.log(`    📦 Payloads captured: ${ep.payloads.length}`);
    }
  });
  
  console.log('\n🍪 Cookies:', results.cookies.length);
  console.log('💾 LocalStorage keys:', Object.keys(results.localStorage).length);
  
  // Save results
  const fs = await import('fs/promises');
  await fs.writeFile('endpoint-recon-results.json', JSON.stringify(results, null, 2));
  console.log('\n✅ Results saved to endpoint-recon-results.json');
}

main().catch(console.error);