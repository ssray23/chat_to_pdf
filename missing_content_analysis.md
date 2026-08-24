# Missing Content Issue Analysis

## The Problem
The user reported that specific sections, particularly code blocks and ASCII diagrams like the "In your setup" timeline, were completely missing from the PDF export of ChatGPT pages.

## What We Tried Previously
1. **Tool Use Cleaners**: We hypothesized that the `cleanNoise` function was accidentally targeting code wrappers via `data-testid*="tool"` selectors. We added exceptions for containers holding `pre`, `code`, or text longer than 80 characters. This did not fix the issue.
2. **Empty Element Cleaners**: We thought our logic to remove empty `<pre>` tags or divs might be triggering incorrectly. We monkey-patched `remove()` in a test environment and verified that the outer wrapper was indeed being removed, but we didn't identify exactly which selector was responsible.

## The Root Cause
The root cause was traced back to the `composerSelectors` array in `cleanNoise()`.
This array is designed to strip out the user input area (the "Composer") by targeting classes like `[class*="composer" i]`.

Recently, ChatGPT updated the DOM structure of their code blocks. The code block wrappers now contain Tailwind CSS variables for theming, specifically:
`dark:[--code-block-surface:var(--composer-surface-primary)]`

Because the class string contained the word `composer`, our case-insensitive selector `[class*="composer" i]` mistakenly matched the entire code block container! As a result, every code block and ASCII diagram was being silently deleted from the DOM clone before export.

## The Fix
We updated all composer-related selectors in `content.js` to explicitly ignore Tailwind CSS variables by using the `:not` pseudo-class:
- Changed `'[class*="composer" i]'` to `'[class*="composer" i]:not([class*="--composer" i])'`
- Changed `'[class*="Composer" i]'` to `'[class*="Composer" i]:not([class*="--composer" i])'`

This surgically targets the actual Composer UI elements without matching the CSS custom variables embedded in the code block classes.

## Result
Running the extraction pipeline over the provided HTML snippet confirms that the ASCII diagrams and code blocks are now perfectly preserved and no longer erroneously removed.
