# Amplifier client web

The current HTTP/SSE/WebSocket web client, imported with its history from
Unified v0.70.0 (`4854dbd9ec555690269747b7dbe273f008e9e179`, `LICENSE` and
`frontend/`). This repository is private. Its independent package is
`@amplifier/client-web`, initially `0.1.0`; no registry release or default
Unified adoption is claimed. Current source changes remain coordinated with
Unified until that handoff is accepted. The retained AHP client is separate.

The [family vision](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/docs/architecture/VISION.md),
[component boundaries](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/contracts/component-boundaries.v1.md) and
[client development contract](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/contracts/client-development.v1.md)
remain the canonical promises. This first extraction preserves the current wire
and declares exactly one server revision per artifact; it adds no negotiation,
compatibility fallback, SDK owner or updater.

## Build and try the independent artifact

Use Node 22 and an owned test environment. Obtain the 15-file canonical export
matching the committed `build-inputs.lock.json`; its producer remains
[Unified's capsule tool](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/frontend/scripts/client-capsule.mjs).
Run `inputs NEW_DIRECTORY` there and supply that directory here:

```sh
npm ci
npm run prepare:inputs -- /path/to/canonical-export
npm run test:portable
npm run build
npm run package:artifact -- /tmp/client-package 4854dbd9ec555690269747b7dbe273f008e9e179
cd /tmp/client-package
npm pack --pack-destination /tmp
```

Commit selected client changes before packaging. Build output is ignored `dist/`;
the zero-runtime-dependency archive contains `static/`, `index.mjs` exporting
`webDirectory`, and `component.json`. The record separates client source,
canonical input provenance, client version/build identity, asset hashes and the
exact declared server peer. Declaration is not compatibility qualification.

Install the archive in an empty consumer with scripts disabled, then run the
named fixture from this checkout:

```sh
npm install --prefix /tmp/client-consumer --ignore-scripts --no-audit --no-fund /tmp/amplifier-client-web-0.1.0.tgz
npm run test:artifact -- /tmp/client-consumer/node_modules/@amplifier/client-web 4854dbd9ec555690269747b7dbe273f008e9e179
```

This fixture uses real HTTP/SSE and the installed browser assets with synthetic
state. It checks history, sending, rendered response, reconnect, retained draft
and no duplicate accepted send. Actual-server qualification remains with
[Unified's paired-server journey](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/frontend/tests/client-paired-server-browser.mjs).

Canonical catalogs, SDK and branding are copied only into ignored `.build-inputs/`.
The committed lock is the trusted selection, not independent authentication of
its declared Git origin. Preparation rejects a different lock or changed,
missing, extra or nonregular files before replacing prior prepared inputs.
Generated inputs and output can be removed after their build/review purpose;
keep the small lock and artifact record. `pyproject.toml` travels in the current
export for provenance but does not supply this component's version.

For connected development, `npm run dev` proxies API/WebSocket requests to an
owned actual server on port 8765. Released Unified installation and its Node-free
asset assembly are a separate distribution responsibility.

## Shared interaction surface

App actions use `POST /api/actions`; `window.amplifier.getActions()` and
`window.amplifier.dispatch(name, args)` expose the same action surface. The
[live-session contract](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/docs/clients/live-sessions.md) owns attachment,
explicit conversation targets, receipts, recovery and device effects. The
bundled client and server evolve together; independently released clients retain
their public contracts.

The [state stream adapter](src/state-stream.js) uses WebSocket events when the
attached host advertises support, with SSE for hosts that do not. Each stream
starts with a `state` snapshot and applies `state-delta` updates to its own
revision baseline. HTTP receipts and recovery reads do not replace that baseline.
Reconnect starts a fresh stream without replaying commands. See
[browser state transport](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/docs/browser-state-transport.md) for bounded
projections, shell events and recovery behavior; measure construction work as
well as bytes under the [performance guidance](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/docs/validation/performance.md).

`window.amplifier.getState()` exposes this browser's state, including private
input, plus a redacted rendered view. It is not the model-facing state projection.
The [browser observation code](src/api.js) excludes private inputs from automatic
`/api/view` reports and rendered-view inspection. Ordinary agent readback also
excludes unsent composer text, message edits and attachment drafts. User-requested
inspection uses the exact `/view/draft` or `/view/messageEdit` pointer and an
explicit `clientId` displaying the calling conversation; a broader read never
opts in. [The projection owner](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/amplifier_web/agent_private_state.py) and
[CS2](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/contracts/client-state.v1.md) define this boundary.

Privacy of model readback does not imply client-only storage. The current host
still stores acknowledged client drafts; the [draft journal](src/draft-journal.js)
keeps unacknowledged composer edits in browser session storage for recovery.
The [client vision](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/docs/clients/VISION.md) describes the target local-only
persistence model, not a completed migration. Settings editors have their own
[draft and credential boundaries](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/docs/SETTINGS.md#boundaries-and-state).

Browser effects (call media, notification permission, and file download) are delivered in `deviceCommands`, with command IDs deduplicated against HTTP responses. Existing effects are not replayed when opening the app. Microphone and notification grants remain browser permission prompts.

## Themes

`src/unified.css` is the complete Amplifier Unified skin. It includes an embedded Amplifier logo from microsoft/amplifier and has no external asset dependencies. The build always links a real CSS file in HTML; theme application does not depend on enabling a disabled stylesheet or on `@scope` support. The same source is copied to `dist/unified.amplifier.css` for reset and export.

The stable root is `#amp-one`, with named `data-part` surfaces. A skin can replace
variables or component styles. See [themes](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/docs/shell/themes.md) for surface
names, library/editor operations, preview versus Apply, and portable CSS validation.
Applied skins are validated by the Python service; use embedded data assets rather
than remote URLs.

## Validation

`npm run test:portable` names the initial standalone checks: app reload, draft
journal, state stream, build identity, branding synchronization, AI connection
actions, chat rows and canonical-input preparation. `npm run test:artifact`
checks the installed archive. Neither command claims the entire inherited suite.

The other inherited test bodies and browser commands remain pending dependency
classification. `npm test` retains its broad unit glob and may require Unified
source; it is not a qualified standalone entrypoint. Do not silently skip failures,
remove assertions or describe the selected portable checks as full-suite success.

Known Unified owners were removed from this current tree, with their history
preserved in the import and their live source/coverage retained upstream:

- [Canonical exporter and producer tests](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/frontend/tests/client-build-inputs.test.mjs).
- [Root DOM-recorder test](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/frontend/tests/browser-dom-recorder.test.mjs).
- [Actual paired-server](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/frontend/tests/client-paired-server-browser.mjs),
  [home sidebar](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/frontend/tests/home-sidebar-browser.mjs),
  [shell](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/frontend/tests/shell-browser.mjs),
  [shell component](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/frontend/tests/shell-components-browser.mjs), and
  [canvas renderer](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/frontend/tests/canvas-renderers-browser.mjs) integration.
- [Shell-example builders](https://github.com/microsoft/amplifier-unified/blob/4854dbd9ec555690269747b7dbe273f008e9e179/frontend/scripts/shell-example-build.mjs),
  their three wrappers and canonical examples/SDK.

Application builds and browser acceptance follow the owning workspace's DTU
rules. Record exact sources and limits. Main owns Unified release/adoption;
this private component does not automatically replace its tested default.

The [build identity owner](scripts/build-identity.mjs) includes authored browser,
public, branding and prepared canonical inputs so a same-version rebuild can offer
reload. Declare actual new build dependencies there. Generated copies are excluded;
the locked dependencies and normal build environment are assumed. This source ID
does not replace release qualification's full-tree, toolchain and exact-asset proof.
