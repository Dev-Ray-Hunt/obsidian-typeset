---
typeset-theme: user-theme.css
---

# Basic Markdown Test Note

This note tests standard Markdown elements that every export must render correctly.

---

## Headings

# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6

---

## Text Formatting

This is a paragraph with **bold text**, *italic text*, and ***bold italic text***. You can also use ~~strikethrough~~ and `inline code`.

This is a second paragraph. Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.

---

## Lists

### Unordered List
- Item one
- Item two
  - Nested item A
  - Nested item B
    - Deeply nested item
- Item three

### Ordered List
1. First item
2. Second item
   1. Nested ordered item
   2. Another nested item
3. Third item

### Task List
- [x] Completed task
- [ ] Incomplete task
- [x] Another completed task
- [ ] Another incomplete task

---

## Links and Images

Here is a [link to Obsidian](https://obsidian.md) and here is a [relative link](edge-cases.md).

---

## Blockquotes

> This is a single-line blockquote.

> This is a multi-line blockquote.
> It continues on the next line.
>
> And has a second paragraph inside it.

> Nested blockquotes:
> > This is nested one level.
> > > This is nested two levels.

---

## Code

Inline code: `const x = 42;`

Fenced code block:

```typescript
function greet(name: string): string {
    return `Hello, ${name}!`;
}

const message = greet("Obsidian");
console.log(message);
```

```css
.my-class {
    color: red;
    font-size: 16px;
}
```

---

## Tables

| Column A | Column B | Column C |
|---|---|---|
| Row 1, A | Row 1, B | Row 1, C |
| Row 2, A | Row 2, B | Row 2, C |
| Row 3, A | Row 3, B | Row 3, C |

| Left aligned | Center aligned | Right aligned |
|:---|:---:|---:|
| Left | Center | Right |
| Text | Text | Text |

---

## Horizontal Rules

---

***

___

---

## Long Paragraph (page break test)

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Pellentesque habitant morbi tristique senectus et netus et malesuada fames ac turpis egestas. Vestibulum tortor quam, feugiat vitae, ultricies eget, tempor sit amet, ante. Donec eu libero sit amet quam egestas semper. Aenean ultricies mi vitae est. Mauris placerat eleifend leo. Quisque sit amet est et sapien ullamcorper pharetra.

Vestibulum erat wisi, condimentum sed, commodo vitae, ornare sit amet, wisi. Aenean fermentum, elit eget tincidunt condimentum, eros ipsum rutrum orci, sagittis tempus lacus enim ac dui. Donec non enim in turpis pulvinar facilisis. Ut felis. Praesent dapibus, neque id cursus faucibus, tortor neque egestas augue, eu vulputate magna eros eu erat. Aliquam erat volutpat.

Nam dui mi, tincidunt quis, accumsan porttitor, facilisis luctus, metus. Phasellus ultrices nulla quis nibh. Quisque a lectus. Donec consectetuer ligula vulputate sem tristique cursus. Nam nulla quam, gravida non, commodo a, sodales sit amet, nisi.
