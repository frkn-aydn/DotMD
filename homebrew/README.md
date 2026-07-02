# Homebrew tap for DotMD

Install on macOS:

```bash
brew tap frkn-aydn/dotmd
brew trust frkn-aydn/dotmd
brew install --cask dotmd
```

Trust the tap once per machine (required by Homebrew for third-party taps). Upgrade with `brew upgrade --cask dotmd`.

## Maintainer: publish updates

This folder is mirrored to [frkn-aydn/homebrew-dotmd](https://github.com/frkn-aydn/homebrew-dotmd). After a new GitHub release:

1. Build macOS installers: `make mac`
2. Print checksums: `../scripts/update-cask-shas.sh VERSION`
3. Update `version` and `sha256` in `Casks/dotmd.rb`
4. Push to `homebrew-dotmd`
