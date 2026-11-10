# Working on the web client

Read [README](README.md) for the current HTTP/SSE boundary, pinned upstream
vision/contracts and build/test scopes. The repository is private; preserve its
visibility. Unified selects a client revision and qualifies its packaged pairing;
source work here does not publish or adopt a new default automatically.

Author browser behavior in `src/`, standalone pages in `public/`, client checks in
`tests/`, and build/preparation tools in `scripts/`. `dist/`, `.build-inputs/`,
generated public branding/licenses and dependencies are disposable output. Do not
edit them or load them into routine source review. Change canonical catalogs,
SDK and branding with their Unified owner, then select a fresh exported lock here.

## Temporary dual-repository maintenance while private

Unified currently ships a committed full snapshot in `components/web-client/`
with `components/web-client.source.json`. A client-only merge is not complete app
delivery: maintain both repositories until an explicitly approved public/
repository-delivery cutover removes the copy and this temporary guidance.
Becoming public alone does not retire the obligation or authorize a visibility change.

For changes originating in either repository, author or port desired client
changes here first and commit them. Then refresh the whole verified snapshot and
source record together using
[Unified's existing workflow](https://github.com/microsoft/amplifier-unified/blob/main/components/README.md#refresh-and-retire-the-copy).
Do not hand-edit the delivery copy or generated assets. Coordinate with the
integration/release owner; avoid duplicate parallel ports, preserve unrelated
work and never roll back a later accepted selection.

The responsible owner must carry synchronization or make an explicit named
integration handoff with exact client and Unified PRs/revisions and pending
status. Report source acceptance, copied selection, build/qualification and
release separately; none implies the next.

## Verification and prepared consumers

`npm test` owns client unit checks; `test:artifact-assets` checks built output.
Named browser journeys and the client registry exercise synthetic client peers;
`test:artifact` exercises an installed artifact. Unified owns actual host/browser,
producer, release and example checks in `tests/web` and assembly in `scripts/`.
Keep each assertion with its owner. Shared generic helper APIs retain one
implementation with injected test-framework facades, not copied implementations.
A fixture pass is not actual-server, provider, release or cross-version acceptance.

The delivery copy and prepared source (`.build/web-client`) are consumers, not
alternative authoring locations; preserve unknown local experiments.
Keep one explicit paired server revision in artifact evidence. Do not add a
compatibility registry, runtime asset override or automatic fallback. Follow the
workspace's owned-DTU rules for builds/browser work and remove obsolete owned
copies when their review purpose ends; preserve useful finite evidence.
