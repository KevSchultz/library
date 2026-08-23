# Kokoro-82M assets

Config, tokenizer, and voice embeddings for the read-aloud feature.

Source: [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX),
an ONNX build of [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M).

Licence: **Apache-2.0** (the model's own licence, not this repository's AGPL-3.0).

`onnx/model_quantized.onnx` (~92MB) is intentionally not committed — see the
`.gitignore` entry. Fetch it with `pnpm -C frontend run fetch:kokoro`, or let the
Docker build's `ADD --checksum=` layer supply it.
