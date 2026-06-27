# AI Chat PDF Exporter Chrome Extension

AI Chat PDF Exporter is a lightweight Chrome extension that parses conversations from Claude, ChatGPT, Gemini, and Grok and exports them into beautifully formatted, print-ready PDF files. 

The extension leverages your custom **Typora theme** (`clean-compact.css`) to render high-fidelity documents in **Helvetica**, featuring left-aligned tables with rounded corners and alternating zebra-striping, strictly on a white page background optimized for ink savings.

---

## Features

- **Multi-Platform Support**: Scrapes and parses conversation threads dynamically from Claude.ai, ChatGPT.com, Gemini.google.com, and Grok.com.
- **Typora CSS Styling**: Integrates your exact [clean-compact.css](file:///Users/suddharay/Library/Mobile%20Documents/com~apple~CloudDocs/Mac%20Projects/AI%20Exporter/clean-compact.css) stylesheet to format paragraphs, headers, blockquotes, lists, and code blocks.
- **Zebra-Striped Rounded Tables**: Converts tables to have 8px rounded corners and alternating light grey shaded rows. Table headers are styled in a light grey-blue and are left-aligned.
- **Offline Rendering & Image Serialization**: Converts all blob images and credentials-locked images to base64 Data URLs so they load in print preview.
- **Canvas Conversion**: Automatically converts interactive canvas elements (such as charts and drawings) into static PNG images for printing.
- **Clean Document Layout**: Renders user queries as blue section headings and assistant replies as continuous body text, avoiding cluttered chat bubbles or avatars.
- **Strictly White Background**: Implements a universal print reset to force all custom wrappers, cards, and page wrappers to be transparent, ensuring zero gray background panels behind tables or text.
- **MV3 & CSP Compliant**: Strictly structured under Manifest V3 security standards, isolating script execution to avoid browser Content Security Policy (CSP) blocks.

---

## Extension Structure

```
AI Exporter/
├── manifest.json         # Extension configuration & content script matching
├── content.js            # Scrapes message threads, serializes images/canvases
├── print.html            # Local printable document wrapper
├── print.js              # Renders conversation nodes dynamically
├── print.css             # Document page rules, text sizes & background resets
├── clean-compact.css     # User-provided Typora markdown stylesheet
├── CHROMEWEBSTORE.md     # Web store publication description & permission guides
└── README.md             # This guide
```

---

## Installation

Since this extension is in development, you can load it unpacked directly in Google Chrome:

1. Open Google Chrome and navigate to: `chrome://extensions/`
2. Enable **Developer mode** using the toggle switch in the top right corner.
3. Click the **Load unpacked** button in the top left.
4. Select your workspace root directory:
   `/Users/suddharay/Library/Mobile Documents/com~apple~CloudDocs/Mac Projects/AI Exporter`
5. The extension **AI Chat PDF Exporter** will appear in your list. Click the Extensions (puzzle piece) icon in your Chrome toolbar and pin it for quick access.

---

## How to Use

1. Open any conversation thread on [Claude](https://claude.ai), [ChatGPT](https://chatgpt.com), [Gemini](https://gemini.google.com), or [Grok](https://grok.com).
2. Click the **AI Exporter** action icon in your Chrome toolbar.
3. The popup will automatically detect the active AI platform. Click **Export to PDF**.
4. A new browser tab will open, showing a clean preview of your styled document.
5. The print dialog will open automatically:
   - **Destination**: Choose **Save as PDF** or select your printer.
   - **More settings**:
     - Keep **Background graphics** checked to print alternating row shading.
     - Uncheck **Headers and footers** if you want to remove default browser URL headers.
6. Click **Save** or **Print**.

---

## How It Works (Technical Overview)

### 1. Robust Page Scraping (`content.js`)
When you click export, the extension queries the DOM for conversation messages. Because AI interfaces frequently update their class names, the script targets a comprehensive list of selectors (including wildcards like `div[class*="font-claude"]` and `div[class*="claude-message"]`). 

The scraper executes a custom tree filter (`getUniqueElements()`) to eliminate duplicate nested tags and sorts the messages in chronological order.

### 2. Image and Canvas Serialization
To prevent image loading failures in the local printable tab (due to origin-locked blob URLs or CORS blocks):
- Every `img` tag's source is loaded and drawn onto an offscreen canvas to extract its base64 data string.
- Every `<canvas>` element (e.g. data visualizations or charts) is captured via `canvas.toDataURL()` and replaced with a static PNG `<img>` tag.

### 3. Local Print Rendering (`print.js` & `print.html`)
The extracted chat nodes are stored in `chrome.storage.local` and loaded into the extension's local tab. Under Manifest V3, inline script execution is prohibited; therefore, rendering and print triggering are handled safely within a separate `print.js` file.

### 4. Background and Table Resets (`print.css`)
To guarantee a strictly white page background and eliminate copied card layouts, the stylesheet applies a universal reset:
- `#write *` forces all child wrappers and custom tags to be transparent.
- `#write *::before, #write *::after` disables pseudo-element background cards.
- Specific Tag selectors restore backgrounds ONLY on core document elements: `#write th` (`#f9f9f9`), `#write tr:nth-child(even)` (`#f5f5f5`), code blocks (`#f8f8f8`), and blockquotes (`#f5f5f5`).

---

## Privacy & Security

AI Chat PDF Exporter values your data privacy:
- **100% Local Execution**: The scraping, image serialization, and PDF compilation occur entirely inside your browser.
- **No Telemetry**: No analytics, external tracking scripts, or server requests are executed. 
- **Minimum Privileges**: Scoped strictly to storage access and AI chat hostnames.
