# Odoo HEIC to JPEG Converter — Summary

## Problem

Clients submit iPhone photos in HEIC format to Odoo SaaS. All major browsers except Safari cannot render HEIC images (due to HEVC licensing). Attachments uploaded to Odoo display as broken images for anyone using Chrome, Firefox, or Edge.

## Why Server-Side Conversion Is Blocked

- **Odoo App Store module** (`attachment_heic_convert`): explicitly unsupported on Odoo Online/SaaS.
- **Custom Python module**: Odoo SaaS uses `safe_eval`, which blocks all `import` statements. No way to load `pillow-heif` or any external library. Server-side HEIC conversion is impossible on SaaS.
- **Client settings**: Asking clients to change iPhone camera settings to "Most Compatible" (JPEG) is unreliable and unenforceable.

## Solution

A Tampermonkey userscript that transparently converts HEIC files to JPEG in the browser before Odoo processes them. Conversion happens at the browser API level — Odoo never sees HEIC data.

## Architecture (v1.4.3)

The script operates in two JavaScript contexts:

### Userscript Scope (Tampermonkey sandbox)

Handles the **update check** (`tools/update-check.template.js`), since `GM_xmlhttpRequest` requires the sandbox. Fetches the `.meta.js` file from GitHub to compare versions and shows a dismissible banner if an update is available.

### Page Context (injected `<script>` tag)

All file-processing patches run in the page's native JS context to avoid Tampermonkey's cross-context isolation issues. An inline `<script>` is injected at `document-start` that:

1. **Loads `heic2any`** via a dynamic `<script src>` tag into the page context
2. **Patches `FileReader.prototype`** — `readAsDataURL`, `readAsArrayBuffer`, `readAsBinaryString`. When Odoo reads a HEIC blob, it's converted to JPEG before the original method executes. Covers any code path that reads file content (previews, base64 encoding).
3. **Patches `XMLHttpRequest.prototype.send`** — when FormData contains HEIC files (field name `ufile`), they're converted to JPEG before the request fires and all FormData entries (including non-HEIC siblings under the same key) are rebuilt in original order. This is the primary upload path — Odoo's `file_upload_service` appends raw `File` objects to FormData and sends via XHR.
4. **Patches `window.fetch`** — same FormData scanning for any fetch-based upload paths.

### Re-Entrancy Guard

`heic2any` internally uses `FileReader.readAsArrayBuffer()` to read the HEIC blob. Without protection, this triggers our FileReader patch recursively. Instead of a global lock across all files, `convertBlob()` tracks active conversions per blob reference via `convertingBlobs` (a reference-counted `WeakMap` with an array fallback), using `markConvertingBlob()`, `unmarkConvertingBlob()`, and `isConvertingBlob()`. When `isConvertingBlob(blob)` is true, `FileReader` calls for that specific blob pass through to the original method unmodified, while concurrent `FileReader` reads on other HEIC blobs are still intercepted and converted. Cleanup runs once on resolution, rejection, or synchronous error.

### Conversion Flow (Drag-and-Drop)

```
User drops .heic file(s) on Odoo chatter
  → Odoo's onDrop handler extracts File(s) from DataTransfer
  → Odoo calls file_upload_service.upload()
  → FormData.append("ufile", originalFile)
  → xhr.send(formData)
  → [OUR XHR PATCH] snapshots FormData entries, finds HEIC file(s)
  → convertBlob(blob) marks blob in convertingBlobs, calls heic2any
  → heic2any internally calls FileReader.readAsArrayBuffer(blob)
  → [OUR FILEREADER PATCH] sees isConvertingBlob(blob) === true, passes through
  → (any concurrent FileReader read on a different HEIC blob2 still converts)
  → heic2any returns JPEG blob
  → convertBlob(blob) unmarks blob in convertingBlobs
  → Affected FormData keys are rebuilt in original order with converted JPEG Files
  → Toast reports actual conversion count (skipping already-readable / failed files)
  → original xhr.send() fires with clean JPEG payload
  → Odoo server receives JPEG attachment(s)
```

## Key Lessons Learned

### Synthetic DOM events don't work (v1.0.0–v1.1.0)

The initial approach intercepted `drop`/`change` events, converted files, and re-dispatched synthetic events. This failed because:
- `new DragEvent({dataTransfer: dt})` — browsers ignore the `dataTransfer` option for security
- `Object.defineProperty` on the event can set `dataTransfer`, but Odoo's OWL framework ignores untrusted events (`event.isTrusted === false`)
- There is no way to make a synthetic event trusted

### Tampermonkey sandbox isolates contexts (v1.1.0)

Patching `unsafeWindow.FileReader.prototype` with functions from the userscript scope silently fails. Cross-context issues include `instanceof` checks, `FormData` iteration, and closure variable access. The fix: inject all patching code as a `<script>` tag into the page's native JS context.

### heic2any uses FileReader internally (v1.2.1)

Patching FileReader and calling `heic2any` (which uses FileReader) creates infinite recursion. The re-entrancy guard must be set inside `convertBlob()` itself, not in the individual patch callbacks, so all call paths are protected.

### Odoo uploads raw File objects (v1.2.2)

Odoo's `file_upload_service` appends the original `File` object directly to FormData (`formData.append("ufile", file)`). It does NOT use FileReader for the upload path. The XHR/fetch patch is the critical interception point for the actual upload; the FileReader patch only covers auxiliary reads (previews, other components).

## Version History

| Version | Change |
|---------|--------|
| 1.0.0 | Initial: event interception with synthetic re-dispatch |
| 1.0.1 | Fix `DragEvent` constructor ignoring `dataTransfer` |
| 1.1.0 | Rewrite: `unsafeWindow` prototype patching (FileReader + fetch + XHR) |
| 1.2.0 | Rewrite: page-context `<script>` injection to fix sandbox isolation |
| 1.2.1 | Fix infinite recursion: add `converting` flag for FileReader patch |
| 1.2.2 | Fix double-conversion: skip browser-readable blobs in `isHeic()` |
| 1.3.0 | Move `converting` flag into `convertBlob()` to guard all call paths |
| 1.4.0 | Standardize `@version` / `SCRIPT_VERSION` and adopt unified `<update-check>` block |
| 1.4.1 | Preserve all FormData entries in order during multi-file uploads |
| 1.4.2 | Replace boolean `converting` with `activeConversions` counter and count only actual conversions in toast |
| 1.4.3 | Replace global `activeConversions` FileReader lock with per-blob ref-counted re-entrancy guard |

## Future Considerations

- **Self-hosted Odoo**: When migrating from SaaS, a server-side Python module using `pillow-heif` can replace the userscript (~50–80 lines of Python).
- **Native browser HEIC support**: Chrome/Firefox may eventually support HEIC as HEVC licensing evolves. WordPress 6.7 already auto-converts HEIC on upload, establishing industry precedent.
- **Odoo native handling**: Odoo may add server-side HEIC conversion in a future version.
