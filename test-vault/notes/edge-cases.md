# Edge Cases Test Note

This note intentionally tests tricky formatting situations that are likely to cause rendering bugs.

---

## Empty Sections

### This section has no content below the heading

### This one either

---

## Very Long Lines

This is a deliberately very long paragraph with no line breaks that should test word wrapping behavior in PDF export: Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident.

A line with a very long unbreakable URL: https://this.is.an.extremely.long.url.that.should.not.break.the.layout.of.the.page.when.rendered.to.pdf.example.com/some/very/long/path/that/keeps/going/and/going?with=query&params=too

---

## Special Characters

### Ampersands and Brackets
AT&T, H&M, R&D, Tom & Jerry

Angle brackets: 1 < 2, 3 > 2, x < y && y > z

### Quotes and Apostrophes
"Double quotes", 'single quotes', "curly double quotes", 'curly single quotes'
It's a contraction. Don't break. Won't you?

### Mathematical Symbols
5 × 3 = 15, 10 ÷ 2 = 5, 90°, ½, ¾, ≠, ≤, ≥, ∞

### Currency
$100.00, €85.50, £72.00, ¥10,000, ₿0.001

### Emoji
🎉 🔥 ✅ ⚠️ 💡 🐉 📄

---

## Deeply Nested Lists

- Level 1
  - Level 2
    - Level 3
      - Level 4
        - Level 5
          - Level 6 (very deep)
  - Back to level 2

1. Ordered level 1
   1. Ordered level 2
      1. Ordered level 3
         - Mixed: unordered inside ordered
           1. Ordered inside unordered inside ordered
   2. Back to ordered level 2

---

## Adjacent Code Blocks

```javascript
const a = 1;
```

```python
b = 2
```

```bash
echo "hello"
```

---

## Empty Code Block

```

```

---

## Table Edge Cases

### Empty cells

| A | B | C |
|---|---|---|
| | middle | |
| left | | right |
| | | |

### Long cell content

| Short | This cell contains a very long string of text that might cause the table to overflow or wrap in unexpected ways during PDF rendering |
|---|---|
| OK | This is another very long cell that tests column width behavior when content significantly exceeds the expected column width |

### Single column table

| Only Column |
|---|
| Row 1 |
| Row 2 |

---

## Consecutive Blank Lines (should collapse)



Three blank lines above this. Two blank lines below.


---

## Blockquote Edge Cases

> Single line.

>
> Blockquote that starts with an empty line.

> A blockquote
followed by a paragraph immediately on the next line with no blank line separator.

---

## Code with Special Characters

```
<html>
  <body class="test" id="main">
    <p style="color: red;">&amp; Hello &lt;World&gt;</p>
  </body>
</html>
```

---

## Heading Right Before EOF (no trailing newline test)

### Last heading
