cask "dotmd" do
  version "1.1.0"

  on_arm do
    sha256 "526b78493e641bc7a3e9f728290ff2b42d6ad0e06c46c733b825b6c9c4626015"
    url "https://github.com/frkn-aydn/DotMD/releases/download/v#{version}/DotMD-#{version}-arm64.dmg"
  end
  on_intel do
    sha256 "85697a2f36b27e29416bdcd68b61a78e859a3f57e0d84200a359008b7e96a0ae"
    url "https://github.com/frkn-aydn/DotMD/releases/download/v#{version}/DotMD-#{version}.dmg"
  end

  name "DotMD"
  desc "Minimal Markdown viewer and editor with View, Edit, and Split modes"
  homepage "https://github.com/frkn-aydn/DotMD"

  app "DotMD.app"

  zap trash: [
    "~/Library/Application Support/DotMD",
    "~/Library/Preferences/com.furkanaydin.dotmd.plist",
    "~/Library/Saved Application State/com.furkanaydin.dotmd.savedState",
  ]
end
