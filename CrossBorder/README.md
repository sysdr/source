<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1abSGiTi60CBfC1X69ppbfcD8nFB1YZnJ

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Testing

Tests run automatically on each push and pull request via GitHub Actions.

- **Run tests:** `npm test`
- **Watch mode:** `npm run test:watch`

The test suite covers services (currency, storage, Stripe sync), components, and core types.
