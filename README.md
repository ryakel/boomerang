# Boomerang

A personal ADHD task manager that won't let things disappear. Tasks always come back.

## Quick Start

```bash
docker run -d -p 3001:3001 -v boomerang-data:/data ghcr.io/ryakel/boomerang:main
```

Open `http://localhost:3001` and add your API keys in Settings.

## Features

- Persistent nagging — snooze requires "then when", reframe after too many snoozes
- AI-powered task suggestions, note polishing, date inference, and reframing
- Recurring tasks (routines) with automatic scheduling
- Notion integration — link or create pages for tasks
- Trello integration — bidirectional sync with AI-inferred list mapping and auto-dedup
- iMessage-style swipe gestures — swipe left for Edit/Done, swipe right to delete
- Custom labels, due dates, extension system
- Push notifications with ADHD-friendly nudges
- Real-time cross-client sync via Server-Sent Events (SSE)
- Dark theme, mobile-first PWA — installable to home screen

## Configuration

API keys can be set via environment variables or in the UI Settings:

```bash
docker run -d -p 3001:3001 \
  -v boomerang-data:/data \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -e NOTION_INTEGRATION_TOKEN=ntn_... \
  -e TRELLO_API_KEY=your_api_key \
  -e TRELLO_SECRET=your_trello_token \
  ghcr.io/ryakel/boomerang:main
```

See the [wiki](https://github.com/ryakel/boomerang/wiki) for full documentation.

## Development

```bash
npm install
cp .env.example .env
node server.js &
npm run dev
```

## License

MIT
