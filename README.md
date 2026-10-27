# Gapai Document Analytics

Desktop app that cross-checks the documents of one person (ID card, family card, passport, CV, certificates, …) and reports what is inconsistent between them, using AI (Claude or OpenAI).

## Features

- One folder per person, with any number of documents. Everything is saved locally.
- Finds mismatches between documents (e.g. `Agung` vs `Agunk`) and information missing from some documents.
- Works with any document type; fields are read dynamically.
- Bring your own API key (Claude or OpenAI), set in Settings.

## Usage

1. Open **Settings**, choose a provider and paste your API key.
2. Create a folder and add at least 2 documents (PDF, PNG, JPG, WEBP).
3. Click **Analyze**, then open the **Results** tab.

## Development

```bash
npm install
npm start
npm test
```

Build installers with `npm run dist:mac` or `npm run dist:win`, or push a version tag (`git tag v0.1.0 && git push --tags`) to build and publish a release through GitHub Actions.

## Note

Documents are sent to the AI provider you choose. Your API key and data are stored unencrypted on your computer. AI results can be wrong, so always verify against the originals.

## License

[MIT](LICENSE) © 2026 Gapai

## Contributors

- Agung Yuliyanto ([@agung96tm](https://github.com/agung96tm))
