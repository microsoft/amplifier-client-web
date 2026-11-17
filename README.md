# Amplifier Web Client

The browser interface for [Amplifier Unified](https://github.com/microsoft/amplifier-unified):
conversations, workspaces, tool activity, and interactive work surfaces. The client
connects to a Unified host over HTTP, server-sent events, and WebSockets; the host
runs agents and stores conversation history.

**To use Amplifier, install [Unified](https://github.com/microsoft/amplifier-unified#readme).**
This repository is for developers working on its web client. Source changes here
do not automatically update a Unified installation.

## Get started

Use Node.js 22. Clone this repository, then install dependencies and prepare the
shared catalogs, SDK, and branding selected by `build-inputs.lock.json`:

```sh
git clone https://github.com/microsoft/amplifier-client-web.git
cd amplifier-client-web
npm ci
npm run prepare:inputs
```

Input preparation fetches the pinned public files and verifies their hashes.
For offline work, use `npm run prepare:inputs -- /path/to/canonical-export` with
the exact locked export.

Run a compatible [Unified development host](https://github.com/microsoft/amplifier-unified/blob/main/CONTRIBUTING.md)
on port 8765, then start the client:

```sh
npm run dev
```

Open the local address printed by Vite. API and WebSocket requests are proxied to
the development host. This client does not install or start the agent backend.

## Suggested messages

On a host that supports app-level suggestions, Settings → Privacy lets you save
an explicit suggestion provider connection, model and reasoning effort, independently of the chat
model. Suggestions are off by default and also require this browser tab's opt-in.
There is no automatic model selection or fallback; a configured connection is
not a claim that every provider or model supports this feature.

The host sends bounded visible conversation text to the selected provider,
including other participants' messages—not an agent's private context or an
unsent draft. The client requests a suggestion only by conversation and committed
message identifiers. The selected chat can request once when idle with an empty
message box while the page is visible and focused, including when you visit an
existing chat. No other chat or background page requests work. Returning to an
unexpired ready suggestion checks its original attempt without another model
call; failed, empty, cancelled or expired sources are not automatically retried.
Starting a new chat before it has a response makes no request. In Settings →
Advanced, the suggestion prompt can be edited and reset to the host default.

The private preview is not part of the editor document. Tab in the focused empty
editor, or **Use suggestion**, adds literal, editable, undoable text; sending is
always a separate action. The mounted browser check
`node tests/transcript-suggestion-mounted-browser.mjs` uses synthetic action
responses. It does not qualify a provider, installed host, or LAN deployment.

## Check and build

```sh
npm test
npm run build
npm run test:artifact-assets
```

The build writes `dist/`. See [package.json](package.json) for focused checks and
[AGENTS.md](AGENTS.md) for source, test, and packaging guidance.

## Unified delivery

This repository owns the browser source. Unified selects an exact accepted public
revision and production-input digest through its
[documented selection workflow](https://github.com/microsoft/amplifier-unified/blob/main/components/README.md#select-public-client-source).
It prepares that source, qualifies the client/server pairing and ships complete
built assets. Installing a released Unified wheel or source distribution does not
require Node or this checkout.

Author changes here first. A client source merge or release does not automatically
update Unified: carry intended changes through selection and release or make a
named integration handoff with exact revisions and pending work.

For interface and design work, use the pinned
[client vision](https://github.com/microsoft/amplifier-unified/blob/816c7a67dbafc20bfb28723dd317c71d3bd2bb28/docs/clients/VISION.md) and
[client development contract](https://github.com/microsoft/amplifier-unified/blob/816c7a67dbafc20bfb28723dd317c71d3bd2bb28/contracts/client-development.v1.md).

See [support](SUPPORT.md), [security reporting](SECURITY.md), and the [MIT license](LICENSE).


<!-- ecosystem-map:start -->
## Where this fits

The selected browser frontend for the current Amplifier Unified application.

Roles: Experience. Supports: Conversation.

![Ecosystem roles and component relationships](docs/ecosystem-map.svg)

[Product page](https://microsoft.github.io/amplifier-constellation/projects/amplifier-client-web/) · [Open the map](docs/ecosystem-map.svg) · [Map guide](https://github.com/microsoft/amplifier-constellation/blob/main/docs/ecosystem-maps.md)

<details>
<summary>The five shared building blocks</summary>

[![Experience, Conversation, Agent Instance, Connection and Tool](https://raw.githubusercontent.com/microsoft/amplifier-constellation/main/site/assets/art/building-blocks.png)](https://microsoft.github.io/amplifier-constellation/)

</details>

<!-- ecosystem-map:end -->

## Contributing

Most contributions require you to agree to a
Contributor License Agreement (CLA) declaring that you have the right to, and actually do, grant us
the rights to use your contribution. For details, visit [Contributor License Agreements](https://cla.opensource.microsoft.com).

When you submit a pull request, a CLA bot will automatically determine whether you need to provide
a CLA and decorate the PR appropriately (e.g., status check, comment). Simply follow the instructions
provided by the bot. You will only need to do this once across all repos using our CLA.

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/).
For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or
contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
