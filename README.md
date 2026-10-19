# Auto Highlight

Ask the AI configured in SiYuan to pick the key points of the current document and colour them:

- **focus** — core judgement (red `#e53935`)
- **info** — facts, data, definitions (blue `#1e88e5`)
- **todo** — action items (orange `#fb8c00`)
- **conclusion** — summary or final conclusion (green `#43a047`)

Use the top-bar button to highlight the whole document, highlight the selection, or clear highlights in the current document.

Highlights are written as inline color marks through `/api/block/updateBlock`; block IDs and other attributes are preserved. Text that already has an inline color is left untouched, so repeated runs stay idempotent.

Rebuilt with Vite 8 + TypeScript + Svelte 5.

## Requirements

- SiYuan desktop 3.7.0+.
- A working AI model configured in **Settings → AI**.

## Development

```bash
pnpm install
pnpm dev
pnpm check
pnpm build
```
