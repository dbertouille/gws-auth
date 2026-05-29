# Google OAuth2 Playground Auth

Get Google OAuth tokens via OAuth Playground.

This tool automates the process of obtaining Google OAuth access and refresh tokens by using Playwright to:
* Open the Google OAuth Playground in a browser
* Auto-fill scopes and start the authorization process
* Wait for user to manually authenticate
* Capture generated tokens and output as JSON

## Prerequisites

Before using this tool, you need:

1. **Google Chrome** - This tool requires Chrome to be installed on your system
   - macOS: [Download Chrome](https://www.google.com/chrome/)
   - Linux: Install via package manager or [download](https://www.google.com/chrome/)
   - Windows: [Download Chrome](https://www.google.com/chrome/)

2. **Google Account** - You'll need to sign in with a Google account during the OAuth flow

3. **Node.js** - Version 18.0.0 or higher

## Usage

Get access token for Drive and Gmail readonly scopes:
```bash
npx github:dbertouille/google-oauth2-playground-auth -s "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.readonly"
```

### Run Locally

```bash
npx . -s "<scopes>"
```

### Example with Multiple Scopes

```bash
npx github:dbertouille/google-oauth2-playground-auth -s "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar.readonly"
```

## How It Works

1. The tool opens Chrome with the Google OAuth Playground
2. It automatically fills in your requested scopes
3. Chrome redirects you to Google sign-in
4. **You manually complete the authentication** (sign in, select account, grant permissions)
5. Once you return to the playground, the tool automatically exchanges the authorization code for tokens
6. Tokens are output as JSON to stdout

## Output Format

```json
{
  "access_token": "ya29.a0AfH6SMBx...",
  "refresh_token": "1//0gX9..."
}
```

## Troubleshooting

**"Failed to launch Chrome browser"**
- Make sure Chrome is installed on your system
- Check that Chrome is accessible in your PATH

**"Failed to load Google OAuth Playground"**
- Check your internet connection
- Verify you can access https://developers.google.com/oauthplayground/ in your browser

**"Timed out waiting for authentication"**
- You have 5 minutes to complete the Google sign-in process
- If you denied permissions, the tool cannot continue

**"Invalid scope format"**
- Scopes must be full URLs like `https://www.googleapis.com/auth/drive`
- Multiple scopes should be space-separated in quotes

## Security Considerations

- This tool requires you to manually authenticate - it cannot access your credentials
- Each run uses a unique temporary browser profile that is deleted after completion
- Tokens are only printed to stdout - they are not stored by this tool
- Always keep your tokens secure and never commit them to version control

## License

ISC
