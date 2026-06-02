# DotMD — build automation
#
# Builds distributables with electron-builder.
#
# Quick start:
#   make install     # install all dependencies (incl. build tools)
#   make all         # build for every platform/arch
#
# Per target:
#   make mac         # macOS Intel + Apple Silicon
#   make mac-intel   # macOS x64 (Intel)
#   make mac-arm     # macOS arm64 (Apple Silicon)
#   make win         # Windows x64 (NSIS installer)
#   make linux       # Linux x64 (AppImage)
#
# Notes:
#   - Cross-compiling has limits: building the Windows installer on macOS/Linux
#     needs Wine, and building Linux from macOS needs Docker. Each platform
#     builds its own target natively without extra tooling.
#   - `--publish never` ensures a local build is never uploaded anywhere.

# Unset ELECTRON_RUN_AS_NODE so tooling behaves consistently, then run the
# locally installed electron-builder via npx.
EB := env -u ELECTRON_RUN_AS_NODE npx electron-builder --publish never

.PHONY: all install mac mac-intel mac-arm win linux clean help

help:
	@echo "Targets:"
	@echo "  make install     Install dependencies + electron-builder"
	@echo "  make all         Build macOS (Intel + arm64), Windows, and Linux"
	@echo "  make mac         Build macOS Intel + Apple Silicon"
	@echo "  make mac-intel   Build macOS x64 (Intel)"
	@echo "  make mac-arm     Build macOS arm64 (Apple Silicon)"
	@echo "  make win         Build Windows x64 installer"
	@echo "  make linux       Build Linux x64 AppImage"
	@echo "  make clean       Remove the dist/ output directory"

install:
	npm install
	npm install -D electron-builder

all: mac win linux

mac: mac-intel mac-arm

mac-intel:
	$(EB) --mac --x64

mac-arm:
	$(EB) --mac --arm64

win:
	$(EB) --win --x64

linux:
	$(EB) --linux --x64

clean:
	rm -rf dist
