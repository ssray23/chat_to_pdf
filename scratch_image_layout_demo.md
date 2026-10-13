# Image Layout Comparison for Markdown (Typora / GitHub)

This file demonstrates how different Markdown / HTML approaches render side-by-side images with surrounding text (like ChatGPT's recipe layout).

---

## 1. Current Exporter Output (Pure Markdown)
*Notice how pure Markdown renders the image full-width / centered, with text below it:*

![1. Build the aromatic base](icons/icon128.png)

### 1. Build the aromatic base
Heat the oil over medium heat. Add the methi seeds and let them turn just golden, not brown. Add curry leaves and let them sizzle briefly. If you enjoy heat, add a slit green chilli.

---

## 2. Why Approach A (align="left") Failed in Typora
*In Typora, Markdown headings (`###`) are block elements that break below floats, and Typora displays raw `<br clear="left"/>` as literal text:*

<img src="icons/icon128.png" align="left" width="140" style="margin-right: 18px; margin-bottom: 8px; border-radius: 8px;" alt="1. Build the aromatic base" />

### 1. Build the aromatic base
Heat the oil over medium heat. Add the methi seeds and let them turn just golden, not brown. Add curry leaves and let them sizzle briefly.

<br clear="left"/>

---

## 3. Approach B: Refined 2-Column Table (Multi-Step ChatGPT Style)
*Using an HTML table with borderless/subtle divider styling produces an exact match to ChatGPT's layout in Typora:*

<table style="border: none; border-collapse: collapse; width: 100%;">
  <tr style="border: none;">
    <td style="border: none; width: 150px; vertical-align: top; padding: 12px 16px 12px 0;">
      <img src="icons/icon128.png" width="140" style="border-radius: 8px; display: block;" alt="Step 1" />
    </td>
    <td style="border: none; vertical-align: top; padding: 12px 0;">
      <strong style="font-size: 1.05rem;">1. Build the aromatic base</strong>
      <p style="margin: 6px 0 0 0; color: #333; line-height: 1.5;">Heat the oil over medium heat. Add the methi seeds and let them turn just golden, not brown. Add curry leaves and let them sizzle briefly.</p>
      <p style="margin: 6px 0 0 0; color: #333; line-height: 1.5;">If you enjoy heat, add a slit green chilli.</p>
    </td>
  </tr>
  <tr style="border-top: 1px solid #e5e5e5;">
    <td style="border: none; width: 150px; vertical-align: top; padding: 12px 16px 12px 0;">
      <img src="icons/icon128.png" width="140" style="border-radius: 8px; display: block;" alt="Step 2" />
    </td>
    <td style="border: none; vertical-align: top; padding: 12px 0;">
      <strong style="font-size: 1.05rem;">2. Fry the masala until thick</strong>
      <p style="margin: 6px 0 0 0; color: #333; line-height: 1.5;">Add the onion and cook for 5–7 minutes until golden. Add ginger-garlic paste, coriander and turmeric. Stir for 30 seconds.</p>
      <p style="margin: 6px 0 0 0; color: #333; line-height: 1.5;">Add the tomatoes and cook for another 6–8 minutes, mashing them as they soften. Let the mixture reduce until it resembles a thick paste rather than a watery gravy.</p>
    </td>
  </tr>
  <tr style="border-top: 1px solid #e5e5e5;">
    <td style="border: none; width: 150px; vertical-align: top; padding: 12px 16px 12px 0;">
      <img src="icons/icon128.png" width="140" style="border-radius: 8px; display: block;" alt="Step 3" />
    </td>
    <td style="border: none; vertical-align: top; padding: 12px 0;">
      <strong style="font-size: 1.05rem;">3. Add stock and tamarind</strong>
      <p style="margin: 6px 0 0 0; color: #333; line-height: 1.5;">Pour in 100 ml chicken stock and stir well. Mix in just 1/2 tsp tamarind paste to start. Simmer uncovered for 3–5 minutes.</p>
    </td>
  </tr>
</table>

---

## 4. Approach C: Standard GFM Markdown Pipe Table
*GFM Markdown table syntax (renders with standard theme grid borders in Typora):*

| Step Image | Instructions |
| :---: | :--- |
| <img src="icons/icon128.png" width="120" style="border-radius: 8px;" /> | **1. Build the aromatic base**<br><br>Heat the oil over medium heat. Add the methi seeds and let them turn just golden, not brown. Add curry leaves and let them sizzle briefly.<br><br>If you enjoy heat, add a slit green chilli. |
| <img src="icons/icon128.png" width="120" style="border-radius: 8px;" /> | **2. Fry the masala until thick**<br><br>Add the onion and cook for 5–7 minutes until golden. Add ginger-garlic paste, coriander and turmeric. Stir for 30 seconds. |
