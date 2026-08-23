# About this fork

This repository is a personal fork of **[grimmory-tools/grimmory](https://github.com/grimmory-tools/grimmory)**
(which is itself a community fork of [Booklore](https://github.com/booklore-app/booklore)).

It is **not** affiliated with, endorsed by, or supported by the Grimmory project.
Please do not report problems with this fork to them — file issues here instead.

## Base

Forked from upstream `develop` at tag **v3.3.2** (`ddb9d3cfc`, 2026-08-18).

## Modifications

Per section 5(a) of the GNU AGPL, the changes carried here beyond upstream v3.3.2:

| Date | Change | Files |
|---|---|---|
| 2026-08-19 | **PDF night mode inverts the page itself.** Upstream's dark theme only recolours EmbedPDF's chrome, leaving the page white. This darkens the page div and inverts its render tiles. | `frontend/src/app/features/readers/pdf-reader/services/embedpdf-book.service.ts`, `frontend/src/assets/embedpdf-frame.html` |
| 2026-08-19 | **Read aloud for PDF and EPUB.** A shared TTS layer with two backends — the browser's `SpeechSynthesis`, and Kokoro-82M running locally in a worker via onnxruntime-web. | `frontend/src/app/features/readers/shared/tts/`, `frontend/src/app/features/readers/ebook-reader/features/tts/`, `frontend/src/app/features/readers/pdf-reader/services/pdf-tts.service.ts`, plus reader components, i18n, `Dockerfile`, `frontend/package.json`, `frontend/angular.json` |

The full change set is in the git history on top of `ddb9d3cfc`.

## Licence

Upstream is licensed under the **GNU Affero General Public License v3.0**, and this
fork is distributed under the same terms. See [LICENSE](LICENSE). Copyright in the
upstream work remains with the Grimmory and Booklore contributors; the modifications
above are © 2026 Kevin Schultz and are offered under the AGPL-3.0 as well.

Because the AGPL covers use over a network, anyone running a modified version of this
as a network service must offer its users the corresponding source.

## Third-party assets added by this fork

Read-aloud bundles the **[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)**
model (Apache-2.0), via the ONNX build at
[onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX).

The ~92MB weights file is **not committed**. It is fetched at build time:

- Docker — an `ADD --checksum=` layer in the [Dockerfile](Dockerfile).
- Local dev — `pnpm -C frontend run fetch:kokoro`.

Both pin the same SHA-256; keep them in step. The small config, tokenizer, and voice
files under `frontend/src/assets/kokoro/` *are* committed, and carry the model's own
Apache-2.0 licence.
