# Chrome Web Store Listing — AI Chat PDF Exporter

> Last Updated: 2026-06-27

## Store Listing

**Extension Name**
AI Chat PDF Exporter

**Short Description**
Export conversations from Claude, ChatGPT, Gemini, and Grok into beautifully styled, print-ready PDF files with white backgrounds.

**Detailed Description**
Save your AI conversations exactly as they look online but optimized for printing. AI Chat PDF Exporter reads conversation threads from major AI platforms (including Claude, ChatGPT, Gemini, and Grok) and formats them into neat multi-page PDFs using a premium clean CSS design.

Key Features:
- Preserves all conversation elements: text formatting, mathematical formulas (LaTeX/KaTeX), code blocks, images, and charts/canvases.
- Renders in Helvetica font for high readability.
- Re-formats tables with rounded corners and alternating zebra-row shading for a clean grid layout.
- Strictly forces a white background on all page sections to optimize for printing and ink usage.
- Intelligent pagination prevents message blocks from cutting off awkwardly across pages.

How to use it:
1. Open any active chat on ChatGPT, Claude, Gemini, or Grok.
2. Click the extension icon in your toolbar.
3. Click "Export to PDF".
4. A new print preview page will open, automatically loading your chat. Choose "Save as PDF" or print.

Privacy & security:
This extension runs completely locally. Your chat histories, images, and text never leave your device. We do not use any external APIs or servers.

**Category**
Productivity

**Single Purpose**
Extracts conversations from AI chat sites and formats them into clean, print-friendly PDF documents.

**Primary Language**
English

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ⬜ Not created | Omitted (Chrome default icon used) |
| Screenshot 1 | 1280×800 | ⬜ Not created | |
| Screenshot 2 | 1280×800 | ⬜ Not created | |

### Screenshot Notes
- Screenshot 1: Show the popup UI active on Claude.ai with the "Export to PDF" button.
- Screenshot 2: Show the print preview window with a formatted chat containing Helvetica text, code blocks, and rounded tables.

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Temporarily holds the extracted conversation HTML/JSON content during the transition from the active tab scraper to the local print tab. |
| `activeTab` | permissions | Allows the extension to interact with the active page DOM when the user clicks the extension action icon. |
| `scripting` | permissions | Injects the content script dynamically if the user is on an AI page that was opened prior to extension installation. |
| `https://chatgpt.com/*` | host_permissions | Scrapes and processes conversation turns, images, and formulas on ChatGPT. |
| `https://claude.ai/*` | host_permissions | Scrapes and processes conversation turns, images, and formulas on Claude. |
| `https://gemini.google.com/*` | host_permissions | Scrapes and processes conversation turns, images, and formulas on Gemini. |
| `https://grok.com/*` | host_permissions | Scrapes and processes conversation turns, images, and formulas on Grok. |
| `https://x.com/*` | host_permissions | Scrapes and processes Grok conversation turns on Twitter/X. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**
Not applicable (No data is collected, stored, or transmitted).

## Distribution

**Visibility**: Public
**Regions**: All regions
**Pricing**: Free

## Developer Info

**Publisher Name**
AI Exporter Team

**Contact Email**
developer@aiexporter.local

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-06-27 | Initial release. Supported platforms: ChatGPT, Claude, Gemini, Grok. | Draft |

## Review Notes

### Known Issues / Limitations
- Canvas elements (charts) are converted to static PNGs. Dynamic animations on canvases are captured in their current static state.
- Highly locked enterprise auth image URLs may fail to convert if CORS restrictions apply, falling back to original source URLs.
