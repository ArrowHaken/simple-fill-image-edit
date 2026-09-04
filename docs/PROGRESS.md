# Image-edit workbench progress

This file tracks reproducible local validation for the `pre-package-full-pipeline`
branch. Secrets, user credentials, and generated image bytes are intentionally
kept outside the repository.

| Date | Stage | Result |
| --- | --- | --- |
| 2026-09-04 | Local startup | FastAPI UI starts on the configured local port. |
| 2026-09-04 | SAM3 baseline | The supplied 768×1024 poster was uploaded and `glasses` produced a completed WaveSpeed SAM3 mask (coverage `0.00629`, inference `2407 ms`). |
| 2026-09-04 | Optional runtime | `/api/health` now remains useful without PyTorch/Big-LaMa; `simple_fill` reports available while the optional LaMa lane reports unavailable. |
| 2026-09-04 | Image2 relay discovery | `relay.catsco.cc/v1/images/edits` is reachable, but the current Bifrost model catalog has no `gpt-image-2` provider mapping. No paid Image2 request was submitted. |
| 2026-09-04 | Production safety | The server was inspected read-only; no production service or configuration was changed. |

## Next validation gate

Before enabling Image2 tests, choose the intended authenticated route:

1. the CatsCo image gateway at `app.catsco.cc/v1/images/edits`, which has an
   Image2 provider pool and requires CatsCo user/Bot authentication; or
2. the Bifrost relay at `relay.catsco.cc/v1`, which currently requires a
   provider-qualified model and does not advertise `gpt-image-2`.

The client should not silently switch between these routes because their
authentication, request format, and provider-selection semantics differ.
