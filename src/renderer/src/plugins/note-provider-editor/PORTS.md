# note-provider-editor

## Metadata

- Domain: `note`
- Category: `provider`
- Name: `editor`
- Entry: `index.tsx`
- Layer: renderer (service plugin, no slot content)

## Dependencies

- Imports `definePlugin` from `workbench/sdk` only; consumes no other plugin.
- Third-party engine: `@milkdown/crepe` (Milkdown Crepe, MIT) plus `@milkdown/kit` (same 7.23.0 pin) for editor commands such as `replaceAll`. Markdown is the source of truth: the document is parsed from Markdown and serialized back to Markdown, so the note file on disk stays plain CommonMark + GFM.
- Crepe features in use: `BlockEdit` (drag handle + slash menu), `Toolbar` (selection bubble toolbar), `CodeMirror` (code blocks), `ListItem`, `Table`, `ImageBlock`, `LinkTooltip`, `Latex`, `Cursor`, `Placeholder`. The persistent `TopBar` is disabled so the editor keeps its space for the document and formatting appears in the floating selection toolbar. `AI` stays disabled.

## Provided services

| Service | Type | Description |
| --- | --- | --- |
| `noteEditor` | `ComponentType<NoteEditorProps>` | WYSIWYG Markdown editor host component |

`NoteEditorProps`:

| Prop | Type | Notes |
| --- | --- | --- |
| `value` | `string` | Markdown body without frontmatter. Read once on mount; the caller remounts (changing `key`) when switching notes. |
| `onChange` | `(markdown: string) => void` | Fires with the serialized Markdown after edits. Manual edits arrive through the engine's debounced `markdownUpdated` (~200 ms, and only for dispatched transactions), so callers must not treat it as synchronous; a programmatic `replaceMarkdown` reports immediately. |
| `readOnly` | `boolean?` | Maps to `Crepe.setReadonly`; used while a write job is running. |
| `resolveImageSrc` | `(src: string) => Promise<string \| null>` | Display-only URL proxy. Returning `null` keeps the original reference, so relative `assets/...` paths are never rewritten into the saved file. |
| `uploadImage` | `(file: File) => Promise<string>` | Decides the reference inserted when an image is pasted or dropped. Default returns `assets/<file.name>` and writes nothing to disk. |
| `onWikiLinkQuery` | `(query: string \| null) => void` | Reports the unfinished `[[query` at the current text caret on keyup, or `null` when the caret is elsewhere. The consumer supplies and displays candidate notes. |
| `onWikiLinkOpen` | `(target: string, label?: string) => void` | Called when a completed `[[target]]` or `[[target\|label]]` token is clicked. The consumer resolves ambiguity and opens the note. |
| `sourceMode` | `boolean?` | Shows an editable raw Markdown textarea when true; defaults to WYSIWYG. The parent owns the toggle so it can place the mode control with the note actions. |
| `onReady` | `(api: NoteEditorApi \| null) => void` | Hands back the editor API once `create()` resolves, and `null` on unmount. It includes Markdown read/replace, wiki-link completion, outline, and statistics methods. `replaceMarkdown` runs Crepe's `replaceAll` and then reports the new serialization through `onChange` itself: the debounced `markdownUpdated` does not reliably fire for a whole-document replacement (measured — the editor showed the new body while the panel stayed on the old one), and programmatic writes are exactly what the MCP acceptance path uses. |

The ready `NoteEditorApi` also provides `completeWikiLink({ target, label? })`, `getOutline()`, `getStats()`, `findNext(query)`, `replaceCurrent(query, replacement)`, and `replaceAll(query, replacement)`. Completion replaces a pending `[[query` before the caret when present, otherwise inserts at the caret. Outline entries contain ATX heading level, plain heading text, and one-based Markdown line. Statistics count non-whitespace Unicode code points as characters, each Han/Hiragana/Katakana/Hangul code point as one word, and other letter/number runs as one word; reading time estimates 400 CJK characters or 80 other words per minute and has a one-minute minimum. Find is case-sensitive plain text, selects the next result and wraps. Replace-current requires the current selection to equal the query; replace-all returns the number replaced and dispatches one editor transaction for undo. WYSIWYG matches do not cross text nodes split by inline formatting; source mode searches the raw Markdown body.

## Behavior

- The component owns the Crepe lifecycle: `create()` on mount, `destroy()` chained after the pending `create()` on unmount, so the React StrictMode double mount cannot leave an orphan editor.
- Theme: `@milkdown/crepe/theme/frame.css` only declares the `--crepe-*` variables; component styles live in `@milkdown/crepe/theme/common/*.css` and are imported for enabled features. `crepe-dark.css` re-declares the same variables under `.dark .milkdown`, follows the DeskSuite global light/dark switch, and uses a compact responsive page inset so document text stays close to the editor edge.
- The LaTeX feature pulls in KaTeX fonts, and `KaTeX_Size3` is inlined as a `data:` font, so the host CSP has to allow `font-src 'self' data:`.
- Known limitation: while `resolveImageSrc` is still pending, Crepe has already put the raw relative reference on the `<img>`, so the renderer logs a `net::ERR_FILE_NOT_FOUND` for each note-relative image (resolved against the app bundle, not the note folder). The picture renders correctly once the proxy answers; removing the noise needs the display URL to exist before the element is inserted.
- Frontmatter, file listing, tags, backlinks, saving and archiving are deliberately out of scope and stay with the consumer.
- Wiki-link syntax is retained as plain Markdown text (`[[target]]` / `[[target|label]]`); this provider reports caret queries and clicked targets but does not resolve note paths or provide the candidate UI. The consumer owns path resolution, ambiguous-title choice, navigation, and backlink indexing.
- Source mode edits the Markdown body only; frontmatter remains the consumer's responsibility. Switching back to WYSIWYG replaces the editor document from the source text and reports the updated Markdown through `onChange`.
- Crepe's exposed toolbar, slash-menu, link, image, code-preview, and heading labels are configured in Chinese. Editor typography uses Chinese-capable font fallbacks and a taller line height; heading and character statistics follow the documented rules above.
- Image blocks use Crepe's built-in resize handle and caption field. The resize ratio serializes in the Markdown image alt metadata and the caption serializes as the Markdown image title; image bytes and source URI are not rewritten. Display dimensions are capped at 960×720 CSS pixels. Alignment controls are not provided: the pinned image-block schema has no alignment attribute or alignment UI, and encoding alignment into Markdown alt text would misuse the image's alt metadata.

## Slots

None.

## Events

None.

## MCP tools

None.

## Renderer storage

None.

- Async creation never publishes onReady after disposal, preventing stale editor handles during rapid note switching.
- `value` and the initial image resolver are captured once per mount. Parent content snapshots and autosave status updates never recreate Crepe; the mounted instance owns selection and undo history. Switching documents or explicitly reloading uses the parent's `path#revision` key; programmatic document edits use the editor API.
