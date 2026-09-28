# AI Chat PDF Exporter Chrome Extension

AI Chat PDF Exporter is a lightweight Chrome extension that parses conversations from Claude, ChatGPT, Gemini, Grok, and Rovo and exports them into beautifully formatted, print-ready PDF files. 

The extension leverages your custom **Typora theme** (`clean-compact.css`) to render high-fidelity documents in **Helvetica**, featuring left-aligned tables with rounded corners and alternating zebra-striping, strictly on a white page background optimized for ink savings.

---

## Features

- **Markdown (.md) Export**: Export full conversation threads directly into clean, portable GitHub-Flavored Markdown files without page setup annoyances, clipped tables, or margin issues.
- **Multi-Platform Support**: Scrapes and parses conversation threads dynamically from Claude.ai, ChatGPT.com, Gemini.google.com, Grok.com, and Atlassian Rovo.
- **Typora CSS Styling**: Integrates your exact [clean-compact.css](<./clean-compact.css>) stylesheet to format paragraphs, headers, blockquotes, lists, and code blocks.
- **Themed Question Cards**: Renders user questions (including complex multiline questions, rich pasted blocks, and blue chat bubbles) inside a soft blue-tinted card with a crisp left accent line for visual contrast.
- **Atlassian Rovo & Jira/Confluence Smart Chips**: Seamlessly extracts pasted media cards, formats Jira issue keys (`DO-1515`) with authentic status lozenges (`Done`, `In Use`), transforms Confluence page links, preserves follow-up suggested prompts (`↳`), and retains sources pills (`10 Sources`).
- **Split List Merging & Whitespace Compacting**: Automatically unifies disjointed `<ol>` lists separated by descriptive paragraphs and collapses excessive whitespace.
- **Zebra-Striped Rounded Tables**: Converts tables to have 8px rounded corners and alternating light grey shaded rows. Table headers are styled in a light grey-blue and are left-aligned.
- **Language Pill Formatting**: Automatically detects raw code block language labels (e.g. "python", "javascript") and converts them into professional, color-themed UI pills.
- **Offline Rendering & Image Serialization**: Converts all blob images, Atlaskit media cards, and credentials-locked images to base64 Data URLs so they load in print preview.
- **Auto-Scaling Cross-Origin Widgets & Artifacts**: Dynamically captures high-resolution screenshots of interactive iframes, Mermaid charts, and React/SVG artifact diagrams (like Claude flowcharts) across all subdomains and origins, flawlessly embedding them at full width in the export.
- **Advanced Widget & Noise Cleaner**: Aggressively strips out chaotic UI noise, reasoning dropdowns (`Thought for Xs`), tool status bars (`V Connecting to visualize...`), copy buttons, and feedback controls while strictly preserving visual media and conversational content.
- **Single Code Block Container**: Enforces strictly 1 outer container card for code blocks across all platforms (such as Gemini's complex nested web components), cleanly eliminating multi-box nesting artifacts while preserving language pill badges.
- **Strictly White Background**: Implements a universal print reset to force all custom wrappers, cards, and page wrappers to be transparent, ensuring zero gray background panels behind tables or text.
- **Dynamic Regression Testing Suite**: Integrates an automated pre-build test runner that validates platform auto-detection, DOM scraping, media card extraction, non-regression visual preservation, and Manifest V3 schema before packaging.
- **MV3 & CSP Compliant**: Strictly structured under Manifest V3 security standards, isolating script execution to avoid browser Content Security Policy (CSP) blocks.

---

## Extension Structure

```
AI Exporter/
├── manifest.json         # Extension configuration & content script matching
├── content.js            # Scrapes message threads, serializes images/canvases
├── md-converter.js       # HTML to GFM Markdown conversion engine
├── print.html            # Local printable document wrapper (PDF export)
├── print.js              # Renders conversation nodes dynamically (PDF export)
├── print.css             # Document page rules, text sizes & background resets
├── clean-compact.css     # User-provided Typora markdown stylesheet
├── CHROMEWEBSTORE.md     # Web store publication description & permission guides
└── README.md             # This guide
```

---

## Installation

Since this extension is in development, you can load it unpacked directly in Google Chrome or Microsoft Edge:

**Google Chrome:**
1. Open Google Chrome and navigate to: `chrome://extensions/`
2. Enable **Developer mode** using the toggle switch in the top right corner.
3. Click the **Load unpacked** button in the top left.
4. Select your workspace root directory:
   `/Users/suddharay/Library/Mobile Documents/com~apple~CloudDocs/Mac Projects/AI Exporter`
5. The extension **AI Chat PDF Exporter** will appear in your list. Click the Extensions (puzzle piece) icon in your Chrome toolbar and pin it for quick access.

**Microsoft Edge:**
1. Open Microsoft Edge and navigate to: `edge://extensions/`
2. Enable **Developer mode** using the toggle switch in the bottom left corner.
3. Click the **Load unpacked** button near the top right.
4. Select your workspace root directory as mentioned above.
5. Pin the extension to your toolbar for quick access.

---

## How to Use

1. Open any conversation thread on [Claude](https://claude.ai), [ChatGPT](https://chatgpt.com), [Gemini](https://gemini.google.com), [Grok](https://grok.com), or Atlassian Rovo.
2. Click the **AI Exporter** action icon in your Chrome toolbar.
3. The popup will automatically detect the active AI platform. Click **Export to Markdown**.
4. The conversation is extracted across all virtualized turns, converted to GitHub-Flavored Markdown, and downloaded as a `.md` file.
5. Open the downloaded `.md` file in **Typora** (configured with your [clean-compact.css](<./clean-compact.css>) theme):
   - User prompts render as cards with a 3px blue accent bar and light card background.
   - Tables render with 8px rounded corners and alternating zebra striping.
   - Code blocks and ASCII architecture diagrams render in JetBrains Mono code fences without line-number gutters.
   - Zero page-break clipping or margin cut-offs!

> [!NOTE]
> The **Export to PDF** button is temporarily disabled in the popup in favor of native Markdown export, which eliminates all page setup and text-clipping issues.

---

## How It Works (Technical Overview)

### 1. Robust Page Scraping & Virtual Scroll Aggregation (`content.js`)
When you click export:
- The extension fires a `beforeprint` event to prompt React/Atlaskit components to un-virtualize hidden conversation turns.
- A virtual scroll collector (`collectTurns`) sweeps the scroll container from top to bottom in smooth, overlapping steps, capturing all mounted message turns in chronological order.
- Each unique turn is cloned immediately into memory (`deepCloneWithShadowsAndSvgs`), preventing virtual unmounting or DOM recycling from discarding off-screen turns.
- A multi-signal role classifier (`isUserTurn`) identifies user prompt bubbles via Atlaskit brand colors (`rgb(12, 102, 228)`), right-alignment, and test IDs, distinguishing them from assistant responses even when rich formatting (`.ak-renderer-document`) is present.
- Sent user questions are preserved regardless of button semantics or container tags, and code-block line-number gutters are cleanly stripped.

### 2. High-Fidelity Markdown Engine (`md-converter.js`)
The zero-dependency conversion engine converts DOM/HTML structures into clean GitHub-Flavored Markdown:
- **Bolded Prompt Cards**: Formats user prompts into prominent blockquotes (`> ### **<question>**` or multi-line `> `) separated by horizontal turn dividers (`---`), matching the Typora theme's `#write blockquote` styling.
- **GFM Tables with Bold Parity Balancing**: Converts HTML tables to aligned pipe tables with normalized columns, escaped pipe characters, and automatic bold marker parity checks so table cell contents ending with parentheses (e.g. `**1. Bulk Purchase (120 seats)**`) always render fully bolded.
- **ASCII Diagrams & Code Fences**: Preserves box-drawing characters (`[─│┌┐└┘├┤┬┴►▼▲◄]`) inside ```` ```text ... ``` ```` fences and strips line-number gutters.
- **Clean Unicode Typography**: Replaces unrendered LaTeX math tokens (`\rightarrow` → `→`, `\times` → `×`, `\le` → `≤`, `\ge` → `≥`) with standard Unicode characters and strips noisy `Preview` link suffixes.

### 3. Image, Canvas, and Iframe Serialization
To prevent media loading failures:
- Every `img` tag's source is loaded and drawn onto an offscreen canvas to extract its base64 data string.
- Every `<canvas>` element (e.g. data visualizations or charts) is captured via `canvas.toDataURL()` and replaced with a static PNG `<img>` tag.
- Cross-origin `<iframe>` widgets are auto-scaled, captured via `chrome.tabs.captureVisibleTab`, and exported as static graphics.

### 4. Background and Table Resets (`print.css` & `clean-compact.css`)
To guarantee a clean layout when printing or viewing:
- Custom wrappers and cards are transparent to ensure zero gray background panels behind tables or text.
- Specific Tag selectors restore backgrounds ONLY on core document elements: `#write th` (`#f9f9f9`), `#write tr:nth-child(even)` (`#f5f5f5`), code blocks (`#f8f8f8`), and blockquotes (`#f5f5f5`).

---

## Recent Fixes & Improvements

1. **Prominent User Question Cards & Bolding ([md-converter.js](<./md-converter.js>)):**
   - Single-line questions are formatted as prominent H3 card headings with explicit bolding (`> ### **<question>**`).
   - Multi-paragraph prompts format the opening statement as `> ### **...**` and preserve bolding across all prompt paragraphs (`> **...**`).
   - Clean horizontal dividers (`---`) separate each conversation turn for clear visual delineation.
2. **Accurate Turn Role Classification on Atlassian Rovo ([content.js](<./content.js>)):**
   - Removed platform name `rovo` from assistant exclusion regexes so user prompt containers with `rovo` attributes are not misclassified as assistant responses.
   - Assistant turns in Rovo are deterministically identified by the presence of Atlaskit's `.ak-renderer-document`, while user turns are identified by blue bubble styling (`#0c66e4`), white text, and lack of `.ak-renderer-document`.
3. **Closing Bold Asterisk Preservation in Tables ([md-converter.js](<./md-converter.js>)):**
   - Replaced an overly aggressive closing-parenthesis regex (`\):?\*\*`) that previously stripped closing double asterisks from phrases like `**1. Bulk Purchase (120 seats)**`.
   - Added automatic cell bold parity balancing in `convertTableNode` to ensure any unclosed bold tag in table cells is safely balanced before export.
4. **Virtual Scroll Turn Sweep & Memory Snapshots ([content.js](<./content.js>)):**
   - Added `collectTurns` to smoothly sweep virtualized chat scroll containers from top to bottom before scraping, snapshotting every turn into memory (`deepCloneWithShadowsAndSvgs`) so offscreen turns are never dropped.
5. **Button Container Preservation ([content.js](<./content.js>)):**
   - Preserves user prompts contained inside `<button>` or `role="button"` elements by converting them to clean `<div>` blocks instead of stripping them as action controls.

---

## Privacy & Security

AI Chat PDF Exporter values your data privacy:
- **100% Local Execution**: The scraping, image serialization, and PDF compilation occur entirely inside your browser.
- **No Telemetry**: No analytics, external tracking scripts, or server requests are executed. 
- **Minimum Privileges**: Scoped strictly to storage access and AI chat hostnames.
