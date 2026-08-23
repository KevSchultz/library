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
| 2026-08-19 | **Read aloud for PDF and EPUB.** A shared TTS layer over the browser's `SpeechSynthesis`, speaking with the voices installed on the reading device. Voices are ranked so the platform's high-quality neural voices (Apple Premium/Enhanced, Microsoft Natural) win, and novelty voices are hidden. | `frontend/src/app/features/readers/shared/tts/`, `frontend/src/app/features/readers/ebook-reader/features/tts/`, `frontend/src/app/features/readers/pdf-reader/services/pdf-tts.service.ts`, plus reader components and i18n |

The full change set is in the git history on top of `ddb9d3cfc`.

## Licence

Upstream is licensed under the **GNU Affero General Public License v3.0**, and this
fork is distributed under the same terms. See [LICENSE](LICENSE). Copyright in the
upstream work remains with the Grimmory and Booklore contributors; the modifications
above are © 2026 Kevin Schultz and are offered under the AGPL-3.0 as well.

Because the AGPL covers use over a network, anyone running a modified version of this
as a network service must offer its users the corresponding source.

## Third-party assets added by this fork

None. Read-aloud uses the speech voices already installed on the reading device
through the browser's Web Speech API, so no model weights or voice data are
bundled or downloaded.

An earlier revision of this fork shipped an in-browser
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) backend. It was removed:
the ~92MB download was a poor trade against the platform's own neural voices,
which start instantly and, on macOS and Windows, sound better.
