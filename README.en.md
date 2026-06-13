# Public Welfare Site Check-in Assistant

[简体中文](README.md) | [English](README.en.md)

A Chrome Manifest V3 extension for managing a small set of supported public welfare sites and running daily check-ins from one side panel.

The extension is designed for sites based on `new-api` and for sites that use LinuxDO OAuth login. It provides preset site entries, one-click check-in, runtime logs, and adapter-based automation for site-specific login and check-in flows.

## Features

- Chrome MV3 extension with a side panel UI.
- One-click daily check-in for all saved sites.
- Preset supported sites, with the option to add detected sites.
- Site-specific adapters for more reliable automation.
- Fallback `new-api` adapter for simple check-in pages.
- LinuxDO OAuth flow support for supported sites.
- Runtime logs stored locally for debugging and review.
- Configurable delay before closing a tab after a successful check-in.

## Supported Sites

Preset sites currently include:

- AnyRouter: `https://anyrouter.top/`
- Muyuan: `https://muyuan.do/`
- Elysiver: `https://elysiver.h-e.top/`
- CHY Public Welfare Site: `https://chybenzun.top/`

Current adapters:

- `anyrouter`: AnyRouter LinuxDO OAuth login and check-in flow.
- `muyuan`: login, announcement handling, agreement checkbox, LinuxDO authorization, settings navigation, and sign-in flow.
- `elysiver`: personal/settings page flow with LinuxDO OAuth and exact sign-in button matching.
- `chybenzun`: profile/API based check-in flow with login-state and already-checked-in detection.
- `new-api-default`: fallback adapter that searches common check-in buttons or links.

## Project Structure

```text
.
|-- adapters/              # Site-specific and fallback check-in adapters
|-- background/            # MV3 service worker and check-in execution engine
|-- content/               # Page detector content script
|-- icons/                 # Extension icons
|-- lib/                   # Storage helpers and preset site definitions
|-- popup/                 # Side panel HTML, CSS, and JavaScript
`-- manifest.json          # Chrome extension manifest
```

## Installation

This project currently has no build step, package manager setup, or automated test runner.

To run it locally:

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project directory.
5. Open the extension side panel.
6. Add preset sites and run the check-in action.

## Development Notes

The extension is implemented with plain JavaScript, HTML, and CSS. It uses Chrome extension APIs directly, including `chrome.storage`, `chrome.tabs`, `chrome.scripting`, and the side panel API.

Adapters are registered in `adapters/registry.js`. To add support for another site, create a new adapter under `adapters/`, implement its matching and check-in logic, and register it before the fallback adapter if it should take precedence.

For automation-heavy sites, prefer robust DOM, URL, and API state checks over assumptions from static HTML. Many target sites are client-rendered and may change their UI over time.

## Privacy

Check-in state, site configuration, and runtime logs are stored locally through Chrome storage. The extension does not include a backend service.

## Status

This is a personal utility project for daily public welfare site check-ins. Live-site automation can be fragile because supported sites and OAuth pages may change, so adapter behavior should be manually verified after updates.
