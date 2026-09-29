# Video tools (free, permissive licences)

CLI wrappers used by the documentary pipeline and the Video Studio. Installed on the CPU worker under `GEN_HOME/tools/`
(`tools-venv` for rembg/spandrel so the image stack in `face-venv` is never touched). Licences, costs and commands
live in `../tools.json` — keep it accurate when adding a tool. `bash tools/smoke.sh scene.png character.png` runs all
of them once and prints timings. Open-licence media search: `integrations/media-sources.mjs`.
