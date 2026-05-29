#!/usr/bin/env node
// Opens Google OAuth Playground in a headed browser, waits for the user to
// authenticate, then prints the access token and refresh token to stdout.

import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseArgs } from 'util';

import { chromium } from 'playwright';

const PLAYGROUND_URL = 'https://developers.google.com/oauthplayground/';

// Timeout constants
const TIMEOUTS = {
  PAGE_LOAD: 10000,
  UI_ELEMENT: 10000,
  GOOGLE_SIGNIN: 60000,
  USER_AUTH: 300000, // 5 minutes for user to complete authentication
  TOKEN_EXCHANGE: 60000,
  WAIT_AFTER_SCOPE_INPUT: 1000,
};

// Selectors observed in the OAuth Playground UI
const SELECTORS = {
  scopeInput: 'input[placeholder*="scope"], input[placeholder*="Enter your own scopes"]',
  authorizeBtn: 'button#authorizeApisButton, button#authdiv_btn, button[ng-click*="authorize"], input[value="Authorize APIs"]',
  exchangeBtn: 'button#exchangeCode, button[ng-click*="exchangeCode"], input[value="Exchange authorization code for tokens"]',
  accessToken: '#for_access_token, #access_token_field, #access_token, input[name="access_token"]',
  refreshToken: '#for_refresh_token, #refresh_token_field, #refresh_token, input[name="refresh_token"]',
};

/**
 * Validates that scopes are in the correct format
 * @param {string} scopes - Space-separated list of OAuth scopes
 */
function validateScopes(scopes) {
  const scopeList = scopes.trim().split(/\s+/);
  for (const scope of scopeList) {
    // Basic validation: reject empty strings or obviously invalid input
    // Accept both full URLs (https://...) and short-form scopes (openid, email, profile, etc.)
    if (!scope || scope.length === 0) {
      console.error('Error: Empty scope provided');
      console.error('Scopes should be full URLs like: https://www.googleapis.com/auth/drive');
      console.error('Or short-form scopes like: openid, email, profile');
      process.exit(1);
    }

    // Reject scopes with invalid characters (spaces, quotes, etc.)
    if (/[\s"'<>]/.test(scope)) {
      console.error(`Error: Invalid characters in scope: "${scope}"`);
      console.error('Scopes should not contain spaces, quotes, or special characters');
      process.exit(1);
    }
  }
}

/**
 * Waits for an element to be visible on the page
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} selector - CSS selector to wait for
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<import('playwright').ElementHandle>} Element handle when visible
 */
async function waitForElement(page, selector, timeout = TIMEOUTS.UI_ELEMENT) {
  return page.waitForSelector(selector, { state: 'visible', timeout });
}

/**
 * Reads the value from an input field or element text content
 * @param {import('playwright').Page} page - Playwright page object
 * @param {string} selector - CSS selector for the field
 * @returns {Promise<string|null>} Field value or null if not found
 */
async function readField(page, selector) {
  const el = await page.$(selector);
  if (!el) {
    return null;
  }
  return el.inputValue().catch(() => el.textContent());
}

/**
 * Main entry point for the CLI application
 */
async function main() {
  // Parse command line arguments
  const { values } = parseArgs({
    options: {
      scopes: {
        type: 'string',
        short: 's',
      },
    },
  });

  const scopes = values.scopes;

  if (!scopes) {
    console.error('Usage: google-oauth2-playground-auth --scopes <scopes>');
    console.error('       google-oauth2-playground-auth -s <scopes>');
    console.error('');
    console.error('Example:');
    console.error('  google-oauth2-playground-auth --scopes "https://www.googleapis.com/auth/drive"');
    console.error('  google-oauth2-playground-auth -s "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/gmail.readonly"');
    process.exit(1);
  }

  validateScopes(scopes);

  // Create a unique temporary directory for this execution
  const profileDir = await mkdtemp(join(tmpdir(), 'google-oauth2-playground-auth-'));
  let browser;

  try {
    // Launch browser
    try {
      browser = await chromium.launchPersistentContext(profileDir, {
        headless: false,
        // Use actual Chrome instead of Chromium
        // Works around Google's bot detection which can block Chromium-based browsers from automating the OAuth flow
        channel: 'chrome',
        args: [
          '--disable-blink-features=AutomationControlled',
        ],
      });
    } catch (err) {
      console.error('Error: Failed to launch Chrome browser.');
      console.error('Make sure Chrome is installed on your system.');
      console.error('Download from: https://www.google.com/chrome/');
      throw err;
    }

    const page = await browser.newPage();

    // Navigate to OAuth Playground
    try {
      await page.goto(PLAYGROUND_URL, { timeout: TIMEOUTS.PAGE_LOAD });
    } catch (err) {
      console.error('Error: Failed to load Google OAuth Playground.');
      console.error('Check your internet connection and try again.');
      throw err;
    }

    // Step 1: enter the scopes
    try {
      const scopeInput = await waitForElement(page, SELECTORS.scopeInput, TIMEOUTS.UI_ELEMENT);
      await scopeInput.fill(scopes);
      await scopeInput.press('Enter');
    } catch (err) {
      console.error('Error: Failed to enter scopes in the OAuth Playground.');
      console.error('The OAuth Playground UI may have changed. Please report this issue.');
      throw err;
    }

    // Step 2: Click the Authorize button
    try {
      const authorizeBtn = await waitForElement(page, SELECTORS.authorizeBtn, TIMEOUTS.UI_ELEMENT);
      await authorizeBtn.click();
    } catch (err) {
      console.error('Error: Failed to click the Authorize button.');
      console.error('The OAuth Playground UI may have changed. Please report this issue.');
      throw err;
    }

    // Step 3: Wait for redirect to Google sign-in
    try {
      await page.waitForURL(/accounts\.google\.com/, { timeout: TIMEOUTS.GOOGLE_SIGNIN });
    } catch (err) {
      console.error('Error: Did not redirect to Google sign-in page.');
      console.error('The authorization process may have failed. Check your scopes and try again.');
      throw err;
    }

    // Step 4: Wait for the Google sign-in flow to complete and return to the playground.
    // Wait for the exchange button to be visible, which means we're back on the playground
    // with the authorization code ready to exchange
    let exchangeBtn;
    try {
      exchangeBtn = await waitForElement(page, SELECTORS.exchangeBtn, TIMEOUTS.USER_AUTH);
    } catch (err) {
      console.error('Error: Timed out waiting for authentication to complete.');
      console.error('Please complete the Google sign-in process within 5 minutes.');
      console.error('If you denied permissions, the process cannot continue.');
      throw err;
    }

    // Step 5: exchange the authorization code for tokens.
    try {
      await exchangeBtn.click();
    } catch (err) {
      console.error('Error: Failed to exchange authorization code for tokens.');
      throw err;
    }

    // Wait until the access token field is populated.
    try {
      await page.waitForFunction(
        (selector) => {
          const el = document.querySelector(selector);
          return el && (el.value || '').trim().length > 10;
        },
        SELECTORS.accessToken.split(',')[0].trim(),
        { timeout: TIMEOUTS.TOKEN_EXCHANGE },
      );
    } catch (err) {
      console.error('Error: Failed to retrieve access token.');
      console.error('The token exchange may have failed. Try again.');
      throw err;
    }

    const accessToken = await readField(page, SELECTORS.accessToken);
    const refreshToken = await readField(page, SELECTORS.refreshToken);

    if (!accessToken) {
      throw new Error('Failed to extract access token from OAuth Playground');
    }

    // Output JSON to stdout immediately
    console.log(JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
    }, null, 2));

    // Browser will be closed in the finally block
  } finally {
    // Ensure cleanup happens even if there's an error
    if (browser) {
      await browser.close().catch(() => {});
    }
    // Clean up the temporary profile directory
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Execute main function
main().catch((err) => {
  // Only log the raw error if it hasn't been handled with a user-friendly message
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
