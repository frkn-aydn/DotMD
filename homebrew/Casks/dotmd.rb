cask "dotmd" do
  version "1.2.1"

  on_arm do
    sha256 "a478486f44192d9dbcef9bb2a514667e70ae26896b2073f61d058cde0a542afb"
    url "https://github.com/frkn-aydn/DotMD/releases/download/v#{version}/DotMD-#{version}-arm64.dmg",
        verified: "github.com/frkn-aydn/DotMD/"
  end
  on_intel do
    sha256 "ee40fa2ee9c79c55fbbb4601fb146fa2eea6fa21bf4da7ac90bf5c6a2fedf02c"
    url "https://github.com/frkn-aydn/DotMD/releases/download/v#{version}/DotMD-#{version}.dmg",
        verified: "github.com/frkn-aydn/DotMD/"
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
