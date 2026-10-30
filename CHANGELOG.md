# Changelog

All notable changes to this fork are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added
- Translate the focused input, textarea or rich-text editor with `Option+A` (`Alt+A` elsewhere). It uses the configured OpenAI- or Anthropic-compatible model, honours a selection, writes back through the browser undo stack and never caches typed text. The target language is configurable (`inputTargetLang`, default English).
- On-demand injection (`activeTab` + `scripting`) from the toolbar popup, shortcuts and context menus, with always-on scripts registered only for sites the user granted.
- Anthropic-compatible default provider entry.
- Options page lists the live browser bindings of the translation shortcuts and links to the browser's shortcut manager.

### Changed
- Synced with upstream `mr-wuliu/wupage` v1.5.5.
- Site access is requested only when needed and only from a click or shortcut (translation service, dictionary, model downloads, PDF origin, image and auto-translation sites). `content_scripts` and `host_permissions` are gone from the manifest.
- Translation shortcuts are browser commands (`chrome.commands`) instead of in-page key listeners.
- Providers are limited to Google web translation, OpenAI-compatible, Anthropic-compatible and the local offline engine; the provider picker is a plain select.
- Stored `deepseek` / `zhipu-glm` entries with an API key migrate to OpenAI-compatible; other removed providers are dropped.

### Fixed
- Saving settings no longer asks for access to untouched default LLM endpoints (e.g. `api.anthropic.com`); only the active service and endpoints with an API key are requested.

### Removed
- Floating ball, its menu and the Debug panel (paragraph mode and the transient notice moved to their own modules).
- Doubao, Microsoft, Tencent, Yandex, Volcengine, MyMemory, Microsoft/Google Cloud API modes, DeepSeek/Zhipu presets, HTTP-template provider, request templates, Ollama compatibility, provider usage statistics and brand icons.
- `declarativeNetRequestWithHostAccess` permission.

### Known limitations
- Cross-origin iframes outside the user's grants are not translated; inputs inside such iframes cannot be translated with the shortcut.
- Real-browser regression scripts (`scripts/test-*.mjs`) still target the old always-injected model and the removed `http-template` provider and have not been ported.
